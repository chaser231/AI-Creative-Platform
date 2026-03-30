/**
 * useProjectSync Hook
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

import { useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useCanvasStore } from "@/store/canvasStore";
import { useWorkspace } from "@/providers/WorkspaceProvider";

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
 * Hook to auto-save canvas state to the backend.
 * Use in the editor page.
 *
 * @param projectId - CUID of the project
 * @param enabled   - Set to true only AFTER the initial canvas load completes.
 *                    This prevents the clear-on-mount from triggering an empty save.
 */
export function useCanvasAutoSave(projectId: string, enabled: boolean = true) {
  const saveStateMutation = trpc.project.saveState.useMutation();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");
  const enabledRef = useRef(enabled);
  const hasEverLoadedRef = useRef(false);
  const isMigratingRef = useRef(false);
  enabledRef.current = enabled;

  // Track when the first successful load happens
  useEffect(() => {
    if (enabled) {
      // Small delay to ensure load has actually populated the store
      const t = setTimeout(() => { hasEverLoadedRef.current = true; }, 500);
      return () => clearTimeout(t);
    }
  }, [enabled]);

  const saveNow = useCallback(async () => {
    // Guard: don't save until initial load is complete
    if (!enabledRef.current) return;
    // Guard: don't save if we haven't loaded at least once
    if (!hasEverLoadedRef.current) return;
    // Guard: don't run concurrent migrations
    if (isMigratingRef.current) return;

    const store = useCanvasStore.getState();

    // Guard: never overwrite a project with empty layers
    // (protects against clear-on-mount race condition)
    if (store.layers.length === 0 && lastSavedRef.current !== "") {
      return;
    }

    // Migrate base64 images to S3 URLs before saving
    let layers = store.layers;
    const hasBase64 = layers.some(
      (l: { type: string; src?: string }) =>
        l.type === "image" && l.src && (l.src.startsWith("data:") || l.src.length > 500)
    );

    if (hasBase64) {
      try {
        isMigratingRef.current = true;
        const { migrateBase64ToS3 } = await import("@/utils/imageUpload");
        const migrated = await migrateBase64ToS3(
          layers as unknown as Array<{ type: string; src?: string; [key: string]: unknown }>,
          projectId
        );
        layers = migrated as unknown as typeof layers;
        // Update local store with S3 URLs so future saves skip migration
        useCanvasStore.setState({ layers });
      } catch (err) {
        console.warn("S3 migration skipped:", err);
        // Continue with base64 — better to save large than not save at all
      } finally {
        isMigratingRef.current = false;
      }
    }

    // Serialize current canvas state
    const canvasState = {
      layers,
      masterComponents: store.masterComponents,
      componentInstances: store.componentInstances,
      resizes: store.resizes,
      artboardProps: store.artboardProps,
      canvasWidth: store.canvasWidth,
      canvasHeight: store.canvasHeight,
    };

    const serialized = JSON.stringify(canvasState);

    // Skip if nothing changed
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    saveStateMutation.mutate(
      { id: projectId, canvasState },
      {
      onError: (err: { message: string }) => {
          console.error("Auto-save failed:", err.message);
        },
      }
    );
  }, [projectId, saveStateMutation]);

  // Synchronous save for unmount — no S3 migration, uses sendBeacon as fallback
  const saveNowSync = useCallback(() => {
    if (!enabledRef.current) return;
    if (!hasEverLoadedRef.current) return;

    const store = useCanvasStore.getState();
    if (store.layers.length === 0 && lastSavedRef.current !== "") return;

    const canvasState = {
      layers: store.layers,
      masterComponents: store.masterComponents,
      componentInstances: store.componentInstances,
      resizes: store.resizes,
      artboardProps: store.artboardProps,
      canvasWidth: store.canvasWidth,
      canvasHeight: store.canvasHeight,
    };

    const serialized = JSON.stringify(canvasState);
    if (serialized === lastSavedRef.current) return;
    lastSavedRef.current = serialized;

    // Use sendBeacon for reliable delivery during navigation/unload
    const payload = JSON.stringify({ projectId, canvasState });
    const blob = new Blob([payload], { type: "application/json" });
    const sent = navigator.sendBeacon("/api/canvas/save", blob);
    if (!sent) {
      // Fallback for large payloads
      fetch("/api/canvas/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    }
  }, [projectId]);

  // Subscribe to canvas store changes and debounce saves
  useEffect(() => {
    // Don't subscribe until enabled
    if (!enabled) return;

    const unsubscribe = useCanvasStore.subscribe(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(saveNow, 1500); // Save 1.5s after last change
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Flush pending save synchronously on cleanup
      saveNowSync();
    };
  }, [saveNow, saveNowSync, enabled]);

  // Save on unmount (leaving editor via React navigation)
  useEffect(() => {
    return () => {
      saveNowSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on page unload (refresh, close tab).
  // tRPC mutations get aborted during page unload, so we use
  // navigator.sendBeacon which guarantees delivery.
  // Fallback: if sendBeacon fails (payload too large), try fetch with keepalive.
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!enabledRef.current) return;
      if (!hasEverLoadedRef.current) return;

      const store = useCanvasStore.getState();

      // Don't save empty state on unload
      if (store.layers.length === 0 && lastSavedRef.current !== "") return;

      const canvasState = {
        layers: store.layers,
        masterComponents: store.masterComponents,
        componentInstances: store.componentInstances,
        resizes: store.resizes,
        artboardProps: store.artboardProps,
        canvasWidth: store.canvasWidth,
        canvasHeight: store.canvasHeight,
      };

      const serialized = JSON.stringify(canvasState);
      if (serialized === lastSavedRef.current) return;

      const payload = JSON.stringify({ projectId, canvasState });
      const blob = new Blob([payload], { type: "application/json" });

      // sendBeacon has a ~64KB limit; fallback to fetch+keepalive for larger payloads
      const sent = navigator.sendBeacon("/api/canvas/save", blob);
      if (!sent) {
        // Fallback: fetch with keepalive survives unload for up to ~4MB
        fetch("/api/canvas/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => { /* best-effort */ });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [projectId]);

  return {
    isSaving: saveStateMutation.isPending,
    lastError: saveStateMutation.error,
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
  // Clear canvas immediately on mount — before any render.
  // canvasStore is a global singleton, so it retains data from previously
  // opened projects. We must wipe it before loading the new project's state.
  useEffect(() => {
    useCanvasStore.setState({
      layers: [],
      selectedLayerIds: [],
      masterComponents: [],
      componentInstances: [],
      history: [],
      future: [],
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
    if (canvasQuery.data && typeof canvasQuery.data === "object") {
      const state = canvasQuery.data as Record<string, unknown>;

      if (state.layers && Array.isArray(state.layers)) {
        // Restore canvas state from DB — always overwrite
        useCanvasStore.setState({
          layers: state.layers as ReturnType<typeof useCanvasStore.getState>["layers"],
          masterComponents: (state.masterComponents ?? []) as ReturnType<typeof useCanvasStore.getState>["masterComponents"],
          componentInstances: (state.componentInstances ?? []) as ReturnType<typeof useCanvasStore.getState>["componentInstances"],
          resizes: (state.resizes ?? useCanvasStore.getState().resizes) as ReturnType<typeof useCanvasStore.getState>["resizes"],
          artboardProps: (state.artboardProps ?? useCanvasStore.getState().artboardProps) as ReturnType<typeof useCanvasStore.getState>["artboardProps"],
          canvasWidth: (state.canvasWidth ?? useCanvasStore.getState().canvasWidth) as number,
          canvasHeight: (state.canvasHeight ?? useCanvasStore.getState().canvasHeight) as number,
        });
      }
    }
    // If load fails (project not in DB), keep the current canvas state.
    // The projectId-change reset above already handles clearing between projects.
  }, [canvasQuery.data]);

  return {
    isLoading: canvasQuery.isLoading,
    isError: canvasQuery.isError,
    // True once the query has completed (success or error)
    isLoaded: canvasQuery.isFetched,
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
          goal: data.goal,
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
