"use client";

/**
 * useCanvasTabLeader
 *
 * React binding around `createCanvasCoordinator`. Mounts ONE coordinator per
 * `projectId` for the lifetime of the editor page. Returns reactive
 * leadership state plus imperative handles for the rest of the editor:
 *
 *   - `isLeader`: whether THIS tab currently owns the autosave lock for
 *     this project. Other tabs of the same project should skip server-side
 *     autosave while this is `false`.
 *   - `requestLead()`: ask whoever currently holds the lock to release it.
 *     Wired to the "Make this tab active" button in the TopBar.
 *   - `broadcastSaved(version, ts)`: leader-only — notify other tabs that
 *     the canonical state has advanced.
 *   - `onSaved(callback)`: subscribe to leader-broadcast `saved` events.
 *     Followers use this to refetch / re-hydrate.
 *
 * The coordinator is a per-tab singleton keyed by `projectId`; a
 * useEffect destroys and recreates it when `projectId` changes.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
    createCanvasCoordinator,
    type CanvasCoordinator,
    type CoordinatorMessage,
} from "@/lib/canvasTabCoordinator";

export interface UseCanvasTabLeaderResult {
    /** Stable per-tab UUID. */
    tabId: string;
    /** `true` if this tab is the active writer for `projectId`. */
    isLeader: boolean;
    /** Has the coordinator mounted yet? Useful to gate UI that depends on knowing the answer. */
    isReady: boolean;
    /** Politely ask the current leader to step down so this tab can take over. */
    requestLead: () => void;
    /** Voluntarily release leadership (e.g. when navigating away from the editor). */
    releaseLead: () => void;
    /** Leader-only: broadcast that the canonical version has advanced. */
    broadcastSaved: (version: number) => void;
    /** Subscribe to leader-broadcast `saved` events. Returns an unsubscribe function. */
    onSaved: (callback: (msg: { version: number; ts: number; tabId: string }) => void) => () => void;
}

export function useCanvasTabLeader(projectId: string | null): UseCanvasTabLeaderResult {
    const coordinatorRef = useRef<CanvasCoordinator | null>(null);
    const [isLeader, setIsLeader] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [tabId, setTabId] = useState<string>("");
    const savedListenersRef = useRef(
        new Set<(msg: { version: number; ts: number; tabId: string }) => void>(),
    );

    useEffect(() => {
        // No coordinator while there's no project (template mode, blank
        // editor) — treat as "always leader" so any local-only flow works.
        if (!projectId) {
            // Sync setState here is intentional: we want the consuming UI
            // to read the "no-project" defaults on the very first paint
            // after projectId becomes null. The alternative (deriving from
            // a ref) would force every consumer to re-implement this.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsLeader(true);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsReady(true);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTabId("");
            return;
        }

        const coordinator = createCanvasCoordinator(projectId);
        coordinatorRef.current = coordinator;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTabId(coordinator.tabId);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsReady(true);

        const offLeader = coordinator.onLeaderChange((next) => {
            setIsLeader(next);
        });

        const offMessage = coordinator.onMessage((msg: CoordinatorMessage) => {
            if (msg.type === "saved") {
                savedListenersRef.current.forEach((cb) => {
                    try {
                        cb({ version: msg.version, ts: msg.ts, tabId: msg.tabId });
                    } catch (err) {
                        console.warn("[useCanvasTabLeader] saved listener threw:", err);
                    }
                });
            }
        });

        return () => {
            offLeader();
            offMessage();
            coordinator.destroy();
            coordinatorRef.current = null;
            // No setState in cleanup: when the hook truly unmounts React
            // discards the updates anyway, and when projectId changes the
            // re-run above immediately seeds fresh state. Setting state in
            // cleanup would only add a redundant render between the two.
        };
    }, [projectId]);

    const requestLead = useCallback(() => {
        coordinatorRef.current?.requestLead();
    }, []);

    const releaseLead = useCallback(() => {
        coordinatorRef.current?.releaseLead();
    }, []);

    const broadcastSaved = useCallback((version: number) => {
        const coord = coordinatorRef.current;
        if (!coord) return;
        coord.postMessage({
            type: "saved",
            version,
            ts: Date.now(),
            tabId: coord.tabId,
        });
    }, []);

    const onSaved = useCallback(
        (callback: (msg: { version: number; ts: number; tabId: string }) => void) => {
            savedListenersRef.current.add(callback);
            return () => {
                savedListenersRef.current.delete(callback);
            };
        },
        [],
    );

    return { tabId, isLeader, isReady, requestLead, releaseLead, broadcastSaved, onSaved };
}
