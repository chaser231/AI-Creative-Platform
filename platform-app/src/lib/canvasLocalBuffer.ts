/**
 * canvasLocalBuffer
 *
 * Per-project IndexedDB buffer for unsaved canvas edits. Last line of defence
 * against data loss when the page is reloaded for any reason — browser crash,
 * OOM, hard refresh, accidental Cmd+W, OS sleep ejecting the tab. Sits next
 * to the existing tRPC autosave (`useCanvasAutoSave`):
 *
 *   user edits → Zustand store
 *     ├─→ canvasLocalBuffer.saveLocalDraft(...)  (immediate, every change)
 *     └─→ tRPC saveState (debounced, every 8 actions / 8s idle)
 *                ↓ on success
 *           canvasLocalBuffer.clearLocalDraft(...)
 *
 * On reload, `useLoadCanvasState` reads the local draft and reconciles with
 * the server state via `baseVersion`:
 *
 *   - localDraft.baseVersion === server.version → safe to apply on top
 *     (these are edits that never reached the server).
 *   - localDraft.baseVersion < server.version → another writer (other tab,
 *     another device) advanced the server state. We keep the server version
 *     as the source of truth and stash the local draft into a "rejected"
 *     slot for manual recovery. We do NOT silently overwrite.
 *
 * Storage backend: `idb-keyval` (~3KB, single object store, async API). One
 * key per project, prefixed `canvas-draft:` for namespacing. A small TTL
 * janitor runs on first read per page load to evict stale entries.
 */

import {
    createStore,
    get as idbGet,
    set as idbSet,
    del as idbDel,
    keys as idbKeys,
    type UseStore,
} from "idb-keyval";

const DB_NAME = "acp-canvas-buffer";
const STORE_NAME = "drafts";
const KEY_PREFIX = "canvas-draft:";
const REJECTED_KEY_PREFIX = "canvas-rejected:";
// 7 days. Generous because a draft past this age is almost certainly
// abandoned (user moved on, account deactivated, project deleted). The
// recovery UI flow expects the user to see their draft within hours, not
// weeks.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let storeInstance: UseStore | null = null;
let janitorRan = false;

/**
 * Lazy store creation — `createStore` opens an IndexedDB connection. We do
 * it on first use rather than module load so SSR doesn't blow up and tests
 * that never touch IDB don't pay the cost.
 */
function getStore(): UseStore | null {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
    if (!storeInstance) {
        try {
            storeInstance = createStore(DB_NAME, STORE_NAME);
        } catch {
            // Private mode / disabled storage / SecurityError. Treat as
            // "no buffer available" — autosave still works, just no local
            // safety net.
            return null;
        }
    }
    return storeInstance;
}

export interface CanvasLocalDraft {
    /** Project ID (CUID) the draft belongs to. */
    projectId: string;
    /**
     * The serialized canvas state. Same shape as `getCanvasStateForSave`
     * output. Kept as `unknown` so this module doesn't import the canvas
     * store types — keeps the buffer reusable from tests.
     */
    snapshot: unknown;
    /**
     * Server `version` the draft is based on. Used for the reconcile
     * decision on load:
     *   draft.baseVersion === server.version  → safe to re-apply
     *   draft.baseVersion <  server.version   → conflict, stash for recovery
     */
    baseVersion: number | null;
    /** ms epoch when this draft was last written. */
    ts: number;
}

function key(projectId: string): string {
    return `${KEY_PREFIX}${projectId}`;
}

function rejectedKey(projectId: string, suffix: string): string {
    return `${REJECTED_KEY_PREFIX}${projectId}:${suffix}`;
}

/**
 * Persist a draft for `projectId`. Overwrites any prior draft (we only keep
 * the latest one — older intermediate states are not useful for recovery).
 *
 * Errors are swallowed and logged: this is a best-effort safety net and
 * MUST NEVER break the editor. The user's primary save path is the tRPC
 * mutation; the buffer is just insurance.
 */
export async function saveLocalDraft(draft: CanvasLocalDraft): Promise<void> {
    const store = getStore();
    if (!store) return;
    try {
        await idbSet(key(draft.projectId), draft, store);
    } catch (err) {
        console.warn("[canvasLocalBuffer] saveLocalDraft failed:", err);
    }
}

/**
 * Read the latest draft for `projectId`. Returns `null` if none exists, the
 * draft is older than TTL, or storage is unavailable.
 *
 * Side effect: triggers the TTL janitor on the first call per page load.
 */
export async function loadLocalDraft(projectId: string): Promise<CanvasLocalDraft | null> {
    const store = getStore();
    if (!store) return null;

    if (!janitorRan) {
        janitorRan = true;
        // Fire-and-forget: don't make the read wait for cleanup of unrelated
        // stale entries from other projects.
        void evictStaleDrafts(store);
    }

    try {
        const raw = (await idbGet(key(projectId), store)) as CanvasLocalDraft | undefined;
        if (!raw) return null;
        if (typeof raw !== "object" || raw === null) return null;
        if (typeof raw.ts !== "number") return null;
        if (Date.now() - raw.ts > TTL_MS) {
            void idbDel(key(projectId), store).catch(() => {});
            return null;
        }
        return raw;
    } catch (err) {
        console.warn("[canvasLocalBuffer] loadLocalDraft failed:", err);
        return null;
    }
}

/**
 * Drop the draft for `projectId`. Call this after the tRPC autosave
 * confirms the server received the same (or newer) state — the draft is no
 * longer needed as a recovery slot.
 */
export async function clearLocalDraft(projectId: string): Promise<void> {
    const store = getStore();
    if (!store) return;
    try {
        await idbDel(key(projectId), store);
    } catch (err) {
        console.warn("[canvasLocalBuffer] clearLocalDraft failed:", err);
    }
}

/**
 * Move a draft into the "rejected" slot. Used when on-load reconciliation
 * detects that the server has advanced past `draft.baseVersion` — the draft
 * cannot be applied automatically without overwriting someone else's work.
 *
 * Stored under a timestamped key so multiple rejections per project don't
 * clobber each other; the recovery UI (future) can list them all.
 */
export async function stashRejectedDraft(draft: CanvasLocalDraft): Promise<void> {
    const store = getStore();
    if (!store) return;
    try {
        await idbSet(rejectedKey(draft.projectId, String(draft.ts)), draft, store);
        await idbDel(key(draft.projectId), store);
    } catch (err) {
        console.warn("[canvasLocalBuffer] stashRejectedDraft failed:", err);
    }
}

async function evictStaleDrafts(store: UseStore): Promise<void> {
    try {
        const now = Date.now();
        const allKeys = await idbKeys(store);
        for (const k of allKeys) {
            if (typeof k !== "string") continue;
            if (!k.startsWith(KEY_PREFIX) && !k.startsWith(REJECTED_KEY_PREFIX)) continue;
            const draft = (await idbGet(k, store)) as CanvasLocalDraft | undefined;
            if (!draft || typeof draft.ts !== "number" || now - draft.ts > TTL_MS) {
                await idbDel(k, store).catch(() => {});
            }
        }
    } catch {
        // Janitor failures are silent — they don't affect the main flow.
    }
}

/**
 * Test/diagnostic helper: drop the cached store handle. Lets vitest reset
 * between specs without poking module internals.
 */
export function __resetCanvasLocalBufferForTests(): void {
    storeInstance = null;
    janitorRan = false;
}
