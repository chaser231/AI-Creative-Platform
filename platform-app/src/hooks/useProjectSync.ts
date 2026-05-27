/**
 * useProjectSync Hook
 *
 * Also generates a thumbnail from the Konva stage on save.
 *
 * Syncs project data between Zustand (in-memory) and backend (tRPC/Prisma).
 * Handles:
 * - Loading project list from backend on mount
 * - Creating projects on backend when created locally
 * - Auto-saving canvas state to backend (debounced)
 * - Loading canvas state from backend when opening editor
 *
 * Strategy: "Optimistic Local, Sync to Backend"
 * The UI continues to work via Zustand stores (instant), 
 * while this hook silently persists changes to the DB.
 */

"use client";

import { useEffect, useRef, useCallback, useState, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "@/store/canvasStore";
import { DEFAULT_RESIZE } from "@/store/canvas/types";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import { getCanvasStateForSave, normalizeCanvasStateForLoad } from "@/utils/canvasState";
import {
  saveLocalDraft,
  loadLocalDraft,
  clearLocalDraft,
  stashRejectedDraft,
  type CanvasLocalDraft,
} from "@/lib/canvasLocalBuffer";
import type Konva from "konva";

/** Internal sentinel projectId used by the editor page in template mode. */
const TEMPLATE_MODE_PROJECT_ID = "__skip__";

// Default workspace ID — will be replaced by WorkspaceProvider later
// For now, we use a hardcoded fallback that gets resolved on first load
let cachedWorkspaceId: string | null = null;

/**
 * Synchronize the project list from backend.
 * Use on the dashboard page.
 * @param onlyMine - if true, filters by createdById (for "Мои проекты")
 */
export function useProjectListSync(onlyMine?: boolean) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? null;

  const projectsQuery = trpc.project.list.useQuery(
    { workspaceId: workspaceId!, onlyMine },
    {
      enabled: !!workspaceId,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  // Cache the workspace ID for other hooks
  useEffect(() => {
    if (workspaceId) {
      cachedWorkspaceId = workspaceId;
    }
  }, [workspaceId]);

  return {
    workspaceId,
    projects: projectsQuery.data ?? [],
    isLoading: !workspaceId || projectsQuery.isLoading,
    isError: projectsQuery.isError,
    refetch: projectsQuery.refetch,
  };
}

/**
 * Shared ref that `useLoadCanvasState` and `useCanvasAutoSave` use to agree on
 * the current optimistic-locking version. Keyed by `projectId` so switching
 * between editors doesn't leak a stale version into the next project.
 *
 * This is deliberately module-level (not a React context) so that the two
 * hooks can communicate without requiring a provider — they're always used
 * together on the editor page, and wrapping every editor in a new provider
 * just for one number is overkill.
 */
const projectVersionRefs = new Map<string, { current: number | null }>();

function getVersionRef(projectId: string) {
  let ref = projectVersionRefs.get(projectId);
  if (!ref) {
    ref = { current: null };
    projectVersionRefs.set(projectId, ref);
  }
  return ref;
}

/**
 * Hook to auto-save canvas state to the backend.
 * Use in the editor page.
 *
 * @param projectId - CUID of the project
 * @param enabled   - Set to true only AFTER the initial canvas load completes.
 *                    This prevents the clear-on-mount from triggering an empty save.
 * @param stageRef  - Optional Konva.Stage ref for thumbnail capture.
 * @param onVersionConflict - Fired when the server reports that the client is
 *                    writing over newer state (another tab / window saved
 *                    first). The editor page should refetch canvas state and
 *                    reconcile. MF-3 deliberately skips auto-retry so we don't
 *                    clobber the newer work.
 * @param tabLeader - Optional cross-tab coordination state. When provided
 *                    AND `tabLeader.isLeader === false`, this hook skips
 *                    server saves entirely (the leader tab handles them) but
 *                    keeps writing to the local IDB buffer so follower edits
 *                    survive an unexpected leader-tab crash. When omitted,
 *                    behaves exactly as before — every instance is a leader
 *                    and the existing optimistic locking handles conflicts.
 */
export function useCanvasAutoSave(
  projectId: string,
  enabled: boolean = true,
  stageRef?: RefObject<Konva.Stage | null>,
  onVersionConflict?: () => void,
  tabLeader?: {
    isLeader: boolean;
    broadcastSaved?: (version: number) => void;
  },
) {
  const saveStateMutation = trpc.project.saveState.useMutation();
  // `.mutate` is stable across renders (TanStack Query guarantees it).
  // Extract it so dependent useCallbacks don't rebuild every time
  // `isPending` / `error` flicker — that was causing the Zustand
  // subscribe effect to cleanup+resubscribe on every render, which
  // fired a spurious `saveNowSync()` beacon each time. Two concurrent
  // writes (tRPC mutate + beacon) race, both bump `version`, and the
  // second one hits `CONFLICT`. See the `useEffect([saveNow,
  // saveNowSync, enabled])` below.
  const saveStateMutate = saveStateMutation.mutate;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const enabledRef = useRef(enabled);
  const hasEverLoadedRef = useRef(false);
  const isMigratingRef = useRef(false);
  const [isMigrating, setIsMigrating] = useState(false);
  // Guards against two concurrent in-flight tRPC saves racing on the
  // same `expectedVersion`. Combined with `needsResaveRef`, this turns
  // overlapping calls into a single queued save.
  const isSavingRef = useRef(false);
  const needsResaveRef = useRef(false);
  const saveCountRef = useRef(0);
  const lastKnownVersionRef = getVersionRef(projectId);
  const onVersionConflictRef = useRef(onVersionConflict);
  const saveNowRef = useRef<(() => Promise<void>) | null>(null);
  // Coordination across tabs: only the leader fires server saves. Followers
  // still write to the local IDB buffer (via the subscribe handler) so their
  // edits survive a leader-tab crash. When undefined, treat as leader so
  // existing single-tab callers don't change behaviour.
  const isLeaderRef = useRef(tabLeader?.isLeader ?? true);
  const broadcastSavedRef = useRef(tabLeader?.broadcastSaved);

  useEffect(() => {
    isLeaderRef.current = tabLeader?.isLeader ?? true;
  }, [tabLeader?.isLeader]);

  useEffect(() => {
    broadcastSavedRef.current = tabLeader?.broadcastSaved;
  }, [tabLeader?.broadcastSaved]);

  useEffect(() => {
    onVersionConflictRef.current = onVersionConflict;
  }, [onVersionConflict]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Track when the first successful load happens
  useEffect(() => {
    if (enabled) {
      // Small delay to ensure load has actually populated the store
      const t = setTimeout(() => { hasEverLoadedRef.current = true; }, 500);
      return () => clearTimeout(t);
    }
  }, [enabled]);

  /** Capture a high-res JPEG thumbnail of just the artboard from the Konva stage */
  const captureThumbnail = useCallback((): string | null => {
    try {
      const stage = stageRef?.current;
      if (!stage) return null;

      const store = useCanvasStore.getState();
      const w = store.canvasWidth;
      const h = store.canvasHeight;

      // Un-zoom and un-pan stage temporarily
      const oldScaleX = stage.scaleX();
      const oldScaleY = stage.scaleY();
      const oldX = stage.x();
      const oldY = stage.y();

      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.draw(); // Synchronous draw to apply transform safely

      // Capture exact artboard coordinates at higher resolution
      const dataUrl = stage.toDataURL({
        x: 0,
        y: 0,
        width: w,
        height: h,
        pixelRatio: 0.5, // Higher quality preview
        mimeType: "image/jpeg",
        quality: 0.8
      });

      // Restore zoom/pan immediately
      stage.scale({ x: oldScaleX, y: oldScaleY });
      stage.position({ x: oldX, y: oldY });
      stage.draw();

      return dataUrl;
    } catch {
      return null;
    }
  }, [stageRef]);

  const saveNow = useCallback(async () => {
    // Guard: don't save until initial load is complete
    if (!enabledRef.current) return;
    // Guard: don't save if we haven't loaded at least once
    if (!hasEverLoadedRef.current) return;
    // Guard: don't run concurrent migrations
    if (isMigratingRef.current) return;
    // Guard: cross-tab coordination — only the leader pushes to the server.
    // Followers' edits are still written to the IDB local buffer (via the
    // Zustand subscribe handler below), so if this tab gets promoted to
    // leader (or the leader crashes), the next page load reconciles them.
    if (!isLeaderRef.current) return;
    // Guard: don't start a new save while the previous one is still in
    // flight. The server increments `version` on every write, so two
    // parallel saves carrying the same `expectedVersion` make the second
    // one fail with CONFLICT. Mark that a follow-up save is required so
    // `onSettled` picks up whatever state landed during the request.
    if (isSavingRef.current) {
      needsResaveRef.current = true;
      return;
    }

    const store = useCanvasStore.getState();

    // Guard: never overwrite a project with empty layers
    // (protects against clear-on-mount race condition)
    if (store.layers.length === 0 && lastSavedRef.current !== "") {
      return;
    }

    // Serialize current canvas state (with per-format snapshots) before image
    // migration so inactive resize snapshots are covered too.
    let canvasState = getCanvasStateForSave(store);

    const { hasPersistableImageSources, persistImageSourcesInObject } = await import("@/utils/imageUpload");
    if (hasPersistableImageSources(canvasState)) {
      try {
        isMigratingRef.current = true;
        setIsMigrating(true);
        canvasState = await persistImageSourcesInObject(canvasState, projectId);
        // CRITICAL: `canvasState.layers` is the canonical (master) snapshot
        // produced by `getCanvasStateForSave` — it intentionally diverges
        // from `store.layers` whenever the user is editing a non-master
        // format. Writing it back into the live store would replace the
        // active format's layers with the master's layers and visually
        // wipe per-format edits a few seconds after the user switches
        // formats. Hydrate the live `layers` from the migrated active
        // resize's snapshot instead, so the canvas keeps showing what the
        // user is actually editing.
        const migratedActiveLayers =
          canvasState.resizes.find((r) => r.id === store.activeResizeId)?.layerSnapshot
          ?? canvasState.layers;
        useCanvasStore.setState({
          layers: migratedActiveLayers,
          resizes: canvasState.resizes,
          artboardProps: canvasState.artboardProps,
          palette: canvasState.palette,
        });
      } catch (err) {
        console.warn("S3 migration skipped:", err);
        // Continue with base64 — better to save large than not save at all
      } finally {
        isMigratingRef.current = false;
        setIsMigrating(false);
      }
    }

    const serialized = JSON.stringify(canvasState);

    // Skip if nothing changed
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    // Capture thumbnail every 3rd save, upload to S3 to avoid large base64 in tRPC payload
    saveCountRef.current += 1;
    let thumbnailUrl: string | undefined;
    if (saveCountRef.current % 3 === 1) {
      const thumbBase64 = captureThumbnail();
      if (thumbBase64) {
        try {
          const { uploadForAI } = await import("@/utils/imageUpload");
          const url = await uploadForAI(thumbBase64, projectId);
          if (url && url !== thumbBase64) thumbnailUrl = url;
        } catch {
          thumbnailUrl = undefined;
        }
      }
    }

    const expectedVersion = lastKnownVersionRef.current;
    isSavingRef.current = true;
    saveStateMutate(
      {
        id: projectId,
        canvasState,
        thumbnail: thumbnailUrl,
        ...(expectedVersion !== null && { expectedVersion }),
      },
      {
        onSuccess: (data: { version?: number }) => {
          if (typeof data?.version === "number") {
            lastKnownVersionRef.current = data.version;
            // Leader → followers: tell the other tabs of this project that
            // the canonical version has advanced so they can refetch and
            // stay in sync. Cheap (single BroadcastChannel post) and
            // optional — followers gracefully degrade without it (they'd
            // just see stale UI until the next refetch).
            broadcastSavedRef.current?.(data.version);
          }
          // The server now holds (at least) the state we just shipped — the
          // local IDB draft is no longer a recovery slot for unsaved edits.
          // If the user makes more edits after this, the subscribe handler
          // will write a fresh draft pegged to the new version.
          if (projectId !== TEMPLATE_MODE_PROJECT_ID) {
            void clearLocalDraft(projectId);
          }
        },
        onError: (err) => {
          // MF-3: version conflict → another tab/retry wrote newer state.
          // Surface it to the caller so they can refetch + reconcile; do
          // NOT auto-retry (would clobber the newer work). We also reset
          // `lastSavedRef` so the next real change still triggers a save
          // attempt once the caller has refetched.
          const code = (err as { data?: { code?: string } | null })?.data?.code;
          if (code === "CONFLICT") {
            // Recoverable — the editor refetches and re-hydrates. Using
            // `warn` instead of `error` so the Next.js dev overlay stays
            // quiet during an expected race.
            console.warn(
              `[useCanvasAutoSave] version conflict for project ${projectId} — refetching`,
            );
            lastSavedRef.current = "";
            // A pending resave here would fire with the still-stale
            // version and CONFLICT again before the refetch finishes.
            // The refetch re-hydrates the store, which triggers a
            // fresh debounced save via the Zustand subscription.
            needsResaveRef.current = false;
            onVersionConflictRef.current?.();
            return;
          }
          console.error("Auto-save failed:", err.message);
        },
        onSettled: () => {
          isSavingRef.current = false;
          // Pick up any edits that arrived while the request was in
          // flight. Use a short delay to coalesce bursts.
          if (needsResaveRef.current) {
            needsResaveRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
              void saveNowRef.current?.();
            }, 200);
          }
        },
      }
    );
  }, [projectId, saveStateMutate, captureThumbnail, lastKnownVersionRef]);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const getUnsavedState = useCallback(() => {
    return !!timeoutRef.current || isMigratingRef.current || saveStateMutation.isPending;
  }, [saveStateMutation.isPending]);

  // Synchronous save for unmount — no S3 migration, uses sendBeacon as fallback
  const saveNowSync = useCallback(() => {
    if (!enabledRef.current) return;
    if (!hasEverLoadedRef.current) return;
    // Leader-only — same reason as saveNow above. A follower's beacon would
    // race the leader's interactive save and either CONFLICT or clobber.
    if (!isLeaderRef.current) return;

    const store = useCanvasStore.getState();
    if (store.layers.length === 0 && lastSavedRef.current !== "") return;

    const canvasState = getCanvasStateForSave(store);

    const serialized = JSON.stringify(canvasState);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    // Never send a large inline thumbnail during unload; the request can be
    // rejected before the server has a chance to drop it.
    const capturedThumbnail = captureThumbnail();
    const thumbnail = capturedThumbnail && capturedThumbnail.startsWith("data:") && capturedThumbnail.length > 200_000
      ? null
      : capturedThumbnail;

    // MF-3: ship last known version alongside the beacon. The endpoint
    // applies soft-merge (warn + last-wins) rather than rejecting, because
    // beacons fire during unload and have no retry path.
    const expectedVersion = lastKnownVersionRef.current;
    const payload = JSON.stringify({
      projectId,
      canvasState,
      thumbnail,
      ...(expectedVersion !== null && { expectedVersion }),
    });
    const blob = new Blob([payload], { type: "application/json" });

    let sent = false;
    try {
        sent = navigator.sendBeacon("/api/canvas/save", blob);
    } catch {}

    if (!sent) {
      // Fallback for large payloads (e.g. over 64KB limit) and for SPA
      // navigation where the page context survives. `keepalive: true`
      // makes the request survive even a real unload, up to ~4MB.
      //
      // We DO read the response here (unlike `sendBeacon`, which is
      // fire-and-forget) so the new server version updates the shared
      // ref. Otherwise the next interactive save uses a stale
      // `expectedVersion`, hits CONFLICT, and the refetch path overwrites
      // the user's freshly edited canvas.
      fetch("/api/canvas/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      })
        .then(async (r) => {
          if (!r.ok) return;
          try {
            const data = (await r.json()) as { version?: number };
            if (typeof data.version === "number") {
              lastKnownVersionRef.current = data.version;
            }
          } catch {
            /* best-effort */
          }
        })
        .catch(() => { /* best-effort */ });
    }
  }, [projectId, captureThumbnail, lastKnownVersionRef]);

  // Subscribe to canvas store changes. Save cadence is action-based:
  //   - Every SAVE_ACTION_THRESHOLD meaningful actions → flush immediately.
  //   - Otherwise arm an idle-flush timer so pauses also get persisted.
  //
  // "Meaningful" = any reference change in a persisted field (layers,
  // resizes, components, artboardProps, canvas size, palette). Selection,
  // hover, zoom, pan, and history-stack changes do NOT count — they were
  // the main source of wasted save trips under the old 1.5s debounce.
  useEffect(() => {
    // Don't subscribe until enabled
    if (!enabled) return;

    const SAVE_ACTION_THRESHOLD = 8; // flush every 8 meaningful actions
    const IDLE_FLUSH_MS = 8000; // fallback flush when user pauses

    type PersistedSnapshot = {
      layers: unknown;
      resizes: unknown;
      masterComponents: unknown;
      componentInstances: unknown;
      artboardProps: unknown;
      canvasWidth: number;
      canvasHeight: number;
      palette: unknown;
    };

    const snapshotPersisted = (s: ReturnType<typeof useCanvasStore.getState>): PersistedSnapshot => ({
      layers: s.layers,
      resizes: s.resizes,
      masterComponents: s.masterComponents,
      componentInstances: s.componentInstances,
      artboardProps: s.artboardProps,
      canvasWidth: s.canvasWidth,
      canvasHeight: s.canvasHeight,
      palette: s.palette,
    });

    let prev: PersistedSnapshot = snapshotPersisted(useCanvasStore.getState());
    let actionCount = 0;

    const scheduleIdleFlush = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        actionCount = 0;
        timeoutRef.current = null;
        saveNow();
      }, IDLE_FLUSH_MS);
    };

    const unsubscribe = useCanvasStore.subscribe((state) => {
      // Shallow reference diff: Zustand slice updates replace the top-
      // level array/object refs, so `!==` is enough to spot real changes
      // without stringifying or deep-comparing layer trees.
      const isMeaningful =
        prev.layers !== state.layers ||
        prev.resizes !== state.resizes ||
        prev.masterComponents !== state.masterComponents ||
        prev.componentInstances !== state.componentInstances ||
        prev.artboardProps !== state.artboardProps ||
        prev.canvasWidth !== state.canvasWidth ||
        prev.canvasHeight !== state.canvasHeight ||
        prev.palette !== state.palette;

      if (!isMeaningful) return;

      prev = snapshotPersisted(state);
      actionCount += 1;

      // Local IDB buffer — write IMMEDIATELY on every meaningful change so
      // that even if the page is killed before the next debounced server
      // save fires (browser crash, OOM, hard refresh, accidental Cmd+W),
      // the draft survives. Fire-and-forget; failures are logged inside
      // the buffer module and must not affect the editor.
      if (projectId !== TEMPLATE_MODE_PROJECT_ID) {
        const snapshot = getCanvasStateForSave(state);
        const draft: CanvasLocalDraft = {
          projectId,
          snapshot,
          baseVersion: lastKnownVersionRef.current,
          ts: Date.now(),
        };
        void saveLocalDraft(draft);
      }

      if (actionCount >= SAVE_ACTION_THRESHOLD) {
        actionCount = 0;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        saveNow();
      } else {
        scheduleIdleFlush();
      }
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Flush pending save on cleanup. Use the tRPC path (`saveNow`)
      // rather than `saveNowSync`/beacon: this cleanup runs on every dep
      // change and on React-only re-mounts (e.g. StrictMode, parent key
      // bumps) where the page is NOT unloading. A beacon there is the
      // main source of phantom CONFLICTs — its response is unreadable,
      // so `lastKnownVersionRef` falls behind by 1 every time, and the
      // next interactive save self-conflicts and triggers a refetch
      // that wipes the user's freshly typed edits. The interactive
      // mutation reads the response and keeps the version in sync.
      void saveNow();
    };
  }, [saveNow, enabled]);

  // Save on unmount (leaving editor via React navigation).
  // Same reasoning as the subscribe-cleanup above: SPA navigation does
  // NOT unload the page, so a tRPC mutation will complete in the
  // background and update `lastKnownVersionRef` via `onSuccess`.
  // `beforeunload` below still handles real refresh/close.
  useEffect(() => {
    return () => {
      // Read through the ref so this effect's deps stay empty and the
      // cleanup doesn't fire on every `saveNow` rebuild.
      void saveNowRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on page unload (refresh, close tab).
  // tRPC mutations get aborted during page unload, so we use
  // navigator.sendBeacon which guarantees delivery.
  // Fallback: if sendBeacon fails (payload too large), try fetch with keepalive.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 1. Warn user if there are pending scheduled saves or active migrations
      const hasUnsaved = !!timeoutRef.current || isMigratingRef.current;
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = "Сохранение изменений... Вы уверены, что хотите выйти?";
        // Note: we don't return here, we still attempt best-effort save below Just In Case they force close!
      }

      // 2. Perform best-effort save on unload
      if (!enabledRef.current) return;
      if (!hasEverLoadedRef.current) return;
      // Leader-only — followers' last edits are still safe in the IDB
      // local buffer, which the next session will reconcile.
      if (!isLeaderRef.current) return;

      const store = useCanvasStore.getState();

      // Don't save empty state on unload
      if (store.layers.length === 0 && lastSavedRef.current !== "") return;

      const canvasState = getCanvasStateForSave(store);

      const serialized = JSON.stringify(canvasState);
      if (serialized === lastSavedRef.current) return;

      // Never send a large inline thumbnail during unload; the request can be
      // rejected before the server has a chance to drop it.
      const capturedThumbnail = captureThumbnail();
      const thumbnail = capturedThumbnail && capturedThumbnail.startsWith("data:") && capturedThumbnail.length > 200_000
        ? null
        : capturedThumbnail;

      const expectedVersion = lastKnownVersionRef.current;
      const payload = JSON.stringify({
        projectId,
        canvasState,
        thumbnail,
        ...(expectedVersion !== null && { expectedVersion }),
      });
      const blob = new Blob([payload], { type: "application/json" });

      // sendBeacon has a ~64KB limit; fallback to fetch+keepalive for larger payloads
      const sent = navigator.sendBeacon("/api/canvas/save", blob);
      if (!sent) {
        // Fallback: fetch with keepalive survives unload for up to ~4MB.
        // If the user cancels the unload via the confirm dialog, the
        // response can still arrive — read `version` so the shared ref
        // stays in sync and the next interactive save doesn't
        // self-conflict.
        fetch("/api/canvas/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        })
          .then(async (r) => {
            if (!r.ok) return;
            try {
              const data = (await r.json()) as { version?: number };
              if (typeof data.version === "number") {
                lastKnownVersionRef.current = data.version;
              }
            } catch {
              /* best-effort */
            }
          })
          .catch(() => { /* best-effort */ });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [projectId, captureThumbnail, lastKnownVersionRef]);

  return {
    isSaving: saveStateMutation.isPending || isMigrating,
    lastError: saveStateMutation.error,
    getUnsavedState,
    saveNowSync,
  };
}

/**
 * Hook to load canvas state from backend when entering the editor.
 * Restores the full canvas state into canvasStore.
 * IMPORTANT: Always clears canvas on mount to prevent stale data
 * from a previous project (canvasStore is a global singleton).
 *
 * Returns `isLoaded` which is true once the initial load attempt completes
 * (success, error, or empty). Use this to gate auto-save.
 */
export function useLoadCanvasState(projectId: string) {
  // Tracks whether we've already attempted to reconcile a local IDB draft
  // for THIS projectId. Reset whenever projectId changes. We only run the
  // local-buffer recovery on the first server hydration per project — a
  // CONFLICT-driven `refetch()` should NOT re-apply local edits (those are
  // exactly what triggered the conflict and need to be kept out of the way
  // until the user resolves the rejected slot manually).
  const hasReconciledLocalDraftRef = useRef(false);

  // Clear canvas immediately on mount — before any render.
  // canvasStore is a global singleton, so it retains data from previously
  // opened projects. We must wipe it before loading the new project's state.
  useEffect(() => {
    hasReconciledLocalDraftRef.current = false;
    useCanvasStore.setState({
      layers: [],
      selectedLayerIds: [],
      masterComponents: [],
      componentInstances: [],
      history: [],
      future: [],
      resizes: [DEFAULT_RESIZE],
      activeResizeId: "master",
      canvasWidth: DEFAULT_RESIZE.width,
      canvasHeight: DEFAULT_RESIZE.height,
      palette: { colors: [], backgrounds: [] },
    });
  }, [projectId]);

  const canvasQuery = trpc.project.loadState.useQuery(
    { id: projectId },
    {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: "always", // Always fetch fresh data
    }
  );

  useEffect(() => {
    // MF-3: `loadState` now returns `{ canvasState, version }`. Extract both
    // — push the version into the shared ref so `useCanvasAutoSave` can send
    // it as `expectedVersion` on the next save.
    const envelope = canvasQuery.data as
      | { canvasState: Record<string, unknown> | null; version: number }
      | null
      | undefined;
    if (!envelope) return;

    const versionRef = getVersionRef(projectId);
    if (typeof envelope.version === "number") {
      versionRef.current = envelope.version;
    }

    const state = envelope.canvasState;
    if (state && typeof state === "object") {
      if (state.layers && Array.isArray(state.layers)) {
        type Resizes = ReturnType<typeof useCanvasStore.getState>["resizes"];
        const resizes = (state.resizes ?? useCanvasStore.getState().resizes) as Resizes;

        // Always open a project on the master format — this is the user-facing
        // "safe default" so generative actions (expand / edit / inpaint) always
        // land on a real, selected format instead of writing into a phantom
        // activeResizeId that no format in the current project matches.
        // Fallbacks: if there's no master, use the first format; as a last
        // resort, fall back to the literal "master" string (matches DEFAULT_RESIZE.id).
        //
        // Exception: if this is a refetch triggered by a version conflict
        // (the user is mid-editing and the store already has a non-trivial
        // active format), keep the user's current format selection so we
        // don't yank them back to master during a background reconcile.
        const currentStore = useCanvasStore.getState();
        const currentActive = currentStore.activeResizeId;
        const hasMeaningfulSession = currentStore.layers.length > 0;
        const currentIsStillValid = resizes.some((r) => r.id === currentActive);
        const preserveCurrent = hasMeaningfulSession && currentIsStillValid;
        const activeResizeId = preserveCurrent
          ? currentActive
          : (
              resizes.find((r) => r.isMaster)?.id
              ?? resizes.find((r) => r.id === "master")?.id
              ?? resizes[0]?.id
              ?? "master"
            );

        // When preserving the user's current format (refetch-during-edit),
        // hydrate layers + canvas size from that format's snapshot instead
        // of the raw top-level state (which reflects whatever format was
        // active when the server write happened — usually the master).
        type Layers = ReturnType<typeof useCanvasStore.getState>["layers"];
        const activeFormat = preserveCurrent
          ? resizes.find((r) => r.id === activeResizeId)
          : undefined;
        const normalized = preserveCurrent
          ? null
          : normalizeCanvasStateForLoad({
              ...state,
              resizes,
              activeResizeId,
            } as Parameters<typeof normalizeCanvasStateForLoad>[0], currentStore);
        const resolvedLayers = (
          activeFormat?.layerSnapshot ?? normalized?.layers ?? state.layers
        ) as Layers;
        const resolvedCanvasWidth = (
          activeFormat?.width ?? normalized?.canvasWidth ?? state.canvasWidth ?? useCanvasStore.getState().canvasWidth
        ) as number;
        const resolvedCanvasHeight = (
          activeFormat?.height ?? normalized?.canvasHeight ?? state.canvasHeight ?? useCanvasStore.getState().canvasHeight
        ) as number;

        useCanvasStore.setState({
          layers: resolvedLayers,
          masterComponents: (state.masterComponents ?? []) as ReturnType<typeof useCanvasStore.getState>["masterComponents"],
          componentInstances: (state.componentInstances ?? []) as ReturnType<typeof useCanvasStore.getState>["componentInstances"],
          resizes: (normalized?.resizes ?? resizes) as ReturnType<typeof useCanvasStore.getState>["resizes"],
          activeResizeId: normalized?.activeResizeId ?? activeResizeId,
          artboardProps: (normalized?.artboardProps ?? state.artboardProps ?? useCanvasStore.getState().artboardProps) as ReturnType<typeof useCanvasStore.getState>["artboardProps"],
          canvasWidth: resolvedCanvasWidth,
          canvasHeight: resolvedCanvasHeight,
          palette: (normalized?.palette ?? state.palette ?? { colors: [], backgrounds: [] }) as ReturnType<typeof useCanvasStore.getState>["palette"],
        });
      }
    }
    // If load fails (project not in DB), keep the current canvas state.
    // The projectId-change reset above already handles clearing between projects.
  }, [canvasQuery.data, projectId]);

  // Local IDB draft reconciliation — runs once per projectId after the
  // server hydration has settled. If the user previously edited this
  // project and the page was killed before autosave caught up (crash, OOM,
  // hard refresh, accidental tab close), we replay those edits on top of
  // the server state.
  //
  // Decision matrix:
  //   draft.baseVersion === server.version
  //     → safe to apply: these edits never reached the server, no other
  //       client has advanced the state, the user picks up exactly where
  //       they left off.
  //   draft.baseVersion <  server.version  (or draft has null baseVersion
  //     and server.version > 0)
  //     → another writer (other tab on this device, another device, the
  //       autosave that DID land before the crash) advanced the server.
  //       We refuse to silently overwrite that work; the draft is moved
  //       into the rejected slot for future manual recovery UI. Server
  //       state stays as-is.
  //   no draft, or draft is for a different baseVersion that we've
  //     already passed → nothing to do.
  useEffect(() => {
    if (projectId === TEMPLATE_MODE_PROJECT_ID) return;
    if (!canvasQuery.isFetched) return;
    if (hasReconciledLocalDraftRef.current) return;
    hasReconciledLocalDraftRef.current = true;

    let cancelled = false;
    void (async () => {
      const draft = await loadLocalDraft(projectId);
      if (cancelled || !draft) return;

      const serverVersion = getVersionRef(projectId).current ?? 0;
      const draftBase = draft.baseVersion ?? 0;

      if (draftBase === serverVersion) {
        // Apply on top. We trust the draft snapshot to be the same shape
        // as the server canvasState (it was produced by
        // `getCanvasStateForSave`).
        const snapshot = draft.snapshot as Record<string, unknown> | null;
        if (!snapshot || typeof snapshot !== "object") return;

        const draftLayers = snapshot.layers as ReturnType<typeof useCanvasStore.getState>["layers"] | undefined;
        if (!Array.isArray(draftLayers)) return;

        const resizes = (snapshot.resizes ?? useCanvasStore.getState().resizes) as ReturnType<typeof useCanvasStore.getState>["resizes"];
        const draftActiveResizeId = (snapshot.activeResizeId as string | undefined) ?? null;
        const normalizedDraft = normalizeCanvasStateForLoad({
          ...snapshot,
          layers: draftLayers,
          resizes,
          activeResizeId: draftActiveResizeId,
        } as Parameters<typeof normalizeCanvasStateForLoad>[0], useCanvasStore.getState());

        useCanvasStore.setState({
          layers: normalizedDraft.layers,
          masterComponents: normalizedDraft.masterComponents,
          componentInstances: normalizedDraft.componentInstances,
          resizes: normalizedDraft.resizes,
          activeResizeId: normalizedDraft.activeResizeId,
          artboardProps: normalizedDraft.artboardProps ?? useCanvasStore.getState().artboardProps,
          canvasWidth: normalizedDraft.canvasWidth,
          canvasHeight: normalizedDraft.canvasHeight,
          palette: normalizedDraft.palette ?? { colors: [], backgrounds: [] },
        });
        console.info(
          `[canvas] restored local draft for project ${projectId} (baseVersion=${draftBase}, ts=${new Date(draft.ts).toISOString()})`,
        );
      } else if (draftBase < serverVersion) {
        // Server moved ahead while this client was offline/dead. Don't
        // clobber. Park the draft in the rejected slot — a future UI
        // surface can let the user inspect / cherry-pick / discard.
        await stashRejectedDraft(draft);
        console.warn(
          `[canvas] local draft rejected for project ${projectId}: baseVersion=${draftBase} < server=${serverVersion}. Stashed for manual recovery.`,
        );
      } else {
        // draftBase > serverVersion shouldn't happen (server is the source
        // of truth for version monotonicity). If it does — likely a stale
        // entry from a deleted-and-recreated project — clear it.
        await clearLocalDraft(projectId);
        console.warn(
          `[canvas] dropping local draft with future baseVersion (${draftBase} > server ${serverVersion}) for project ${projectId}.`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canvasQuery.isFetched, projectId]);

  return {
    isLoading: canvasQuery.isLoading,
    isError: canvasQuery.isError,
    // True once the query has completed (success or error)
    isLoaded: canvasQuery.isFetched,
    // MF-3: callers (editor page) use this to reconcile after a version
    // conflict reported by `useCanvasAutoSave`.
    refetch: canvasQuery.refetch,
  };
}

/**
 * Hook for creating a project that syncs to backend.
 */
export function useCreateProjectSync() {
  const createMutation = trpc.project.create.useMutation();

  const createProject = useCallback(
    async (data: { name: string; goal: string; workspaceId?: string }) => {
      const wsId = data.workspaceId ?? cachedWorkspaceId;
      if (!wsId) {
        console.error("No workspace ID available for project creation");
        return null;
      }

      try {
        const project = await createMutation.mutateAsync({
          name: data.name,
          workspaceId: wsId,
          goal: data.goal as "banner" | "text" | "video" | "photo",
        });
        return project;
      } catch (err) {
        console.error("Failed to create project on backend:", err);
        return null;
      }
    },
    [createMutation]
  );

  return {
    createProject,
    isPending: createMutation.isPending,
  };
}

export { cachedWorkspaceId };
