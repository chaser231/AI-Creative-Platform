/**
 * canvasTabCoordinator
 *
 * Cross-tab coordination for the canvas editor. Solves two problems:
 *
 * 1. **Save races between tabs.** Before this module, opening the same
 *    project in two tabs led to constant `CONFLICT` ping-pong: each tab's
 *    autosave would land first, the other would refetch, the user would
 *    keep editing, conflict again, etc. Resolution: only one tab per
 *    project saves to the server at a time — the "leader". Other tabs are
 *    "followers" and skip server writes (their edits still hit the local
 *    IDB buffer for zero-loss).
 *
 * 2. **Stale UI in non-active tabs.** When the leader successfully saves,
 *    it broadcasts the new `version` (and optionally the snapshot) over a
 *    BroadcastChannel; followers can refetch / re-hydrate so the user
 *    doesn't see ghost-old state when they come back to that tab.
 *
 * Implementation:
 *   - Primary path uses Web Locks API (`navigator.locks`). Browser
 *     guarantees the lock survives across event-loop ticks and is
 *     automatically released when the tab dies (close, crash, OOM).
 *     Coverage: Chrome 69+, Firefox 96+, Safari 15.4+ — all our targets.
 *   - Fallback for ancient Safari / browsers without Web Locks: degrade
 *     gracefully — every tab acts as a leader. The existing optimistic
 *     locking on the server (`expectedVersion` + `CONFLICT` retry) still
 *     guarantees correctness, just with the original CONFLICT churn.
 */

const LOCK_NAME_PREFIX = "canvas-leader:";
const CHANNEL_NAME_PREFIX = "canvas-sync:";

export type CoordinatorMessage =
    | { type: "saved"; version: number; ts: number; tabId: string }
    | { type: "request-takeover"; tabId: string }
    | { type: "leader-changed"; tabId: string };

export interface CanvasCoordinator {
    /** Stable identifier for this tab (UUID). */
    readonly tabId: string;
    /** Snapshot read of leadership status. */
    isLeader(): boolean;
    /** Subscribe to leadership transitions. Fires once with current value on subscribe. */
    onLeaderChange(callback: (isLeader: boolean) => void): () => void;
    /** Subscribe to messages from other tabs (never echoes our own). */
    onMessage(callback: (msg: CoordinatorMessage) => void): () => void;
    /** Send a message to other tabs over the BroadcastChannel. */
    postMessage(msg: CoordinatorMessage): void;
    /**
     * Voluntarily release leadership. The next waiter on the lock becomes
     * leader. No-op if we're not the leader.
     */
    releaseLead(): void;
    /**
     * Ask the current leader (whoever they are) to release the lock so we
     * can take over. Used by the "Make this tab active" UI affordance.
     */
    requestLead(): void;
    /** Tear down: release lock, close channel, drop listeners. */
    destroy(): void;
}

function safeBroadcastChannel(name: string): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    try {
        return new BroadcastChannel(name);
    } catch {
        return null;
    }
}

function generateTabId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function createCanvasCoordinator(projectId: string): CanvasCoordinator {
    const tabId = generateTabId();
    const lockName = `${LOCK_NAME_PREFIX}${projectId}`;
    const channelName = `${CHANNEL_NAME_PREFIX}${projectId}`;
    const channel = safeBroadcastChannel(channelName);

    let isLeader = false;
    let destroyed = false;
    let releaseHold: (() => void) | null = null;
    const leaderListeners = new Set<(value: boolean) => void>();
    const messageListeners = new Set<(msg: CoordinatorMessage) => void>();

    const setLeader = (next: boolean) => {
        if (isLeader === next) return;
        isLeader = next;
        leaderListeners.forEach((cb) => {
            try {
                cb(next);
            } catch (err) {
                console.warn("[canvasTabCoordinator] leader listener threw:", err);
            }
        });
        if (next && channel) {
            try {
                channel.postMessage({ type: "leader-changed", tabId } satisfies CoordinatorMessage);
            } catch {
                // postMessage on closed channel — ignore.
            }
        }
    };

    const handleIncomingMessage = (event: MessageEvent) => {
        const data = event.data as CoordinatorMessage | undefined;
        if (!data || typeof data !== "object" || !("type" in data)) return;
        // Same-tab messages don't echo back through BroadcastChannel by
        // spec, but we still defensively skip our own tabId in case
        // anyone forwarded a message.
        if ("tabId" in data && data.tabId === tabId) return;

        if (data.type === "request-takeover" && isLeader) {
            // A peer wants the lock. Resolve the holding promise so the
            // navigator.locks callback returns and the lock is released
            // — the requester (or any other waiter) will then acquire it.
            releaseHold?.();
            releaseHold = null;
        }

        messageListeners.forEach((cb) => {
            try {
                cb(data);
            } catch (err) {
                console.warn("[canvasTabCoordinator] message listener threw:", err);
            }
        });
    };

    channel?.addEventListener("message", handleIncomingMessage);

    if (
        typeof navigator !== "undefined" &&
        "locks" in navigator &&
        navigator.locks &&
        typeof navigator.locks.request === "function"
    ) {
        // Web Locks path. The callback Promise determines how long we hold
        // the lock — we keep it open until either destroy() or
        // releaseLead() resolves the inner Promise.
        void navigator.locks
            .request(lockName, { mode: "exclusive" }, async () => {
                if (destroyed) return;
                setLeader(true);
                await new Promise<void>((resolve) => {
                    releaseHold = resolve;
                });
                setLeader(false);
            })
            .catch((err) => {
                console.warn("[canvasTabCoordinator] lock acquisition failed:", err);
            });
    } else {
        // Fallback: no Web Locks API → every tab self-elects as leader.
        // Correctness is preserved by the existing server-side optimistic
        // locking (expectedVersion → CONFLICT → refetch). This is a
        // degraded mode, not a correctness issue.
        console.warn(
            "[canvasTabCoordinator] navigator.locks unavailable — running in single-tab mode without coordination.",
        );
        setLeader(true);
    }

    return {
        tabId,
        isLeader: () => isLeader,
        onLeaderChange(callback) {
            leaderListeners.add(callback);
            // Fire current value synchronously so consumers don't have to
            // race the first transition.
            try {
                callback(isLeader);
            } catch (err) {
                console.warn("[canvasTabCoordinator] leader listener threw on subscribe:", err);
            }
            return () => {
                leaderListeners.delete(callback);
            };
        },
        onMessage(callback) {
            messageListeners.add(callback);
            return () => {
                messageListeners.delete(callback);
            };
        },
        postMessage(msg) {
            if (!channel) return;
            try {
                channel.postMessage(msg);
            } catch {
                // Channel might be closed; ignore.
            }
        },
        releaseLead() {
            releaseHold?.();
            releaseHold = null;
        },
        requestLead() {
            if (!channel) return;
            try {
                channel.postMessage({ type: "request-takeover", tabId } satisfies CoordinatorMessage);
            } catch {
                // ignore
            }
        },
        destroy() {
            destroyed = true;
            releaseHold?.();
            releaseHold = null;
            channel?.removeEventListener("message", handleIncomingMessage);
            channel?.close();
            leaderListeners.clear();
            messageListeners.clear();
        },
    };
}
