"use client";

/**
 * useIdleSessionRefresh
 *
 * Replacement for NextAuth's default `refetchOnWindowFocus` behaviour, which
 * refetches the session on EVERY tab focus and was the root cause of the
 * "page refreshes when switching tabs" stability bug (status flicker through
 * `loading` made WaitlistGuard remount the entire children tree).
 *
 * Strategy: only call `updateSession()` when the page becomes visible AND the
 * user has been idle for `idleThresholdMs` (default 10 minutes). This still
 * picks up admin-side account deactivations within ~10 min, but avoids
 * pointless DB round-trips every time the user alt-tabs.
 *
 * Mount this hook ONCE near the root (e.g. inside WaitlistGuard or
 * RootLayout client wrapper). Multiple instances are safe but redundant.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const DEFAULT_IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const INTERACTION_THROTTLE_MS = 30 * 1000; // 30s — don't store every mousemove
// Anti-spam: never refetch more often than this even if the user keeps
// hiding/showing the tab. Cheap insurance against pathological cases.
const MIN_REFRESH_GAP_MS = 60 * 1000;

const INTERACTION_EVENTS = ["mousedown", "keydown", "touchstart", "pointerdown"] as const;

export function useIdleSessionRefresh(idleThresholdMs: number = DEFAULT_IDLE_THRESHOLD_MS) {
    const { status, update: updateSession } = useSession();
    // Initialise to 0; we set the real timestamp inside the effect to avoid
    // calling Date.now() during render (react-hooks/purity).
    const lastInteractionRef = useRef<number>(0);
    const lastInteractionWriteRef = useRef<number>(0);
    const lastRefreshRef = useRef<number>(0);
    const inFlightRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        // Seed: pretend the user just interacted when the hook mounts.
        // Otherwise the very first visibility flip after mount would look
        // like an eternity-old idle and trigger an unnecessary refresh.
        if (lastInteractionRef.current === 0) {
            lastInteractionRef.current = Date.now();
        }

        const handleInteraction = () => {
            const now = Date.now();
            // Throttle writes — high-frequency events like mousemove would
            // otherwise burn cycles. We only need ~30s resolution.
            if (now - lastInteractionWriteRef.current < INTERACTION_THROTTLE_MS) return;
            lastInteractionWriteRef.current = now;
            lastInteractionRef.current = now;
        };

        const handleVisibility = () => {
            if (document.visibilityState !== "visible") return;
            if (status !== "authenticated") return;
            if (inFlightRef.current) return;

            const now = Date.now();
            const idleFor = now - lastInteractionRef.current;
            const sinceLastRefresh = now - lastRefreshRef.current;

            if (idleFor < idleThresholdMs) return;
            if (sinceLastRefresh < MIN_REFRESH_GAP_MS) return;

            inFlightRef.current = true;
            lastRefreshRef.current = now;
            // Treat the focus itself as an interaction so we don't fire
            // again immediately on the next visibility flip.
            lastInteractionRef.current = now;

            void Promise.resolve(updateSession())
                .catch((err) => {
                    console.warn("[auth] idle session refresh failed:", err);
                })
                .finally(() => {
                    inFlightRef.current = false;
                });
        };

        for (const evt of INTERACTION_EVENTS) {
            window.addEventListener(evt, handleInteraction, { passive: true });
        }
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            for (const evt of INTERACTION_EVENTS) {
                window.removeEventListener(evt, handleInteraction);
            }
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [idleThresholdMs, status, updateSession]);
}
