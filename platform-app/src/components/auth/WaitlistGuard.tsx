"use client";

/**
 * WaitlistGuard
 *
 * Client-side redirect component that checks the user's account status.
 * - PENDING/REJECTED → redirect to /auth/waitlist
 * - APPROVED or undefined (legacy session) → render children normally
 * - Not authenticated → skip (middleware handles redirect to signin)
 *
 * Wraps the main app layout to enforce waitlist before any platform access.
 *
 * --- Stickiness (anti-refresh) ---
 * Once we have confirmed an APPROVED userId in this tab, we cache that fact in
 * `sessionStorage` and keep rendering children even when `useSession().status`
 * momentarily flickers through `loading` (e.g. during an explicit
 * `updateSession()`). Without this, the entire children tree would unmount and
 * remount each time NextAuth re-fetched the session — visually identical to a
 * spontaneous page refresh, and the canvas editor lost its in-memory state.
 * The cache is per-tab (sessionStorage), invalidated when userId changes or
 * when the auth probe explicitly confirms the session is gone.
 */

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { confirmAuthSessionMissing } from "@/lib/authClient";
import { logAuthDiagnostic } from "@/lib/authDiagnostics";
import { useIdleSessionRefresh } from "@/hooks/useIdleSessionRefresh";

// Routes that bypass the waitlist guard
const BYPASS_ROUTES = [
    "/auth/signin",
    "/auth/waitlist",
    "/auth/error",
    "/api/",
];

// sessionStorage key for the "sticky approved userId" cache. Per-tab so multi-
// tab sessions don't accidentally trust each other's approvals.
const APPROVED_USER_ID_KEY = "acp_last_approved_user_id";

function readApprovedUserIdCache(): string | null {
    if (typeof window === "undefined") return null;
    try {
        return window.sessionStorage.getItem(APPROVED_USER_ID_KEY);
    } catch {
        return null;
    }
}

function writeApprovedUserIdCache(userId: string | null) {
    if (typeof window === "undefined") return;
    try {
        if (userId) {
            window.sessionStorage.setItem(APPROVED_USER_ID_KEY, userId);
        } else {
            window.sessionStorage.removeItem(APPROVED_USER_ID_KEY);
        }
    } catch {
        // sessionStorage may be unavailable in private mode — fall back to
        // the in-memory state only. Stickiness across remounts is lost but
        // the guard still works.
    }
}

export function WaitlistGuard({ children }: { children: ReactNode }) {
    const { data: session, status, update: updateSession } = useSession();
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    // Lazy initializer reads sessionStorage once on first render so a remount
    // (e.g. React StrictMode, parent provider re-render) doesn't flash the
    // spinner if we already approved earlier in the tab's lifetime.
    const [approvedUserId, setApprovedUserId] = useState<string | null>(() =>
        readApprovedUserIdCache(),
    );
    const [freshStatusCheckedForUserId, setFreshStatusCheckedForUserId] = useState<string | null>(
        () => readApprovedUserIdCache(),
    );
    const refreshingUserIdRef = useRef<string | null>(null);
    const previousStatusRef = useRef<string | null>(null);
    const unauthenticatedProbeRef = useRef(false);

    // Replacement for the SessionProvider's old refetchOnWindowFocus default:
    // only refresh the session on tab focus if the user has been idle for >10
    // minutes. See useIdleSessionRefresh.ts for rationale.
    useIdleSessionRefresh();

    const accountStatus = session?.user?.status;
    const userId = session?.user?.id ?? null;
    const isBypassRoute = BYPASS_ROUTES.some((route) => pathname.startsWith(route));
    const hasCheckedFreshStatus = status === "authenticated" && freshStatusCheckedForUserId === userId;
    // Sticky approval: once this tab has confirmed an APPROVED userId, treat
    // it as still approved across status flickers. Only cleared when (a) the
    // server-side probe confirms the session is gone, or (b) NextAuth resolves
    // a different userId (account switch).
    const hasStickyApproval = approvedUserId !== null && (userId === null || userId === approvedUserId);

    useEffect(() => {
        const previousStatus = previousStatusRef.current;
        if (previousStatus === status) return;

        logAuthDiagnostic("session_status_changed", {
            from: previousStatus,
            to: status,
            pathname,
            userId,
            accountStatus,
            isBypassRoute,
        });
        previousStatusRef.current = status;
    }, [accountStatus, isBypassRoute, pathname, status, userId]);

    // Force-refresh session once on mount to get fresh status from DB.
    // This handles stale cached sessions that don't include the status field
    useEffect(() => {
        if (
            status !== "authenticated" ||
            !userId ||
            freshStatusCheckedForUserId === userId ||
            refreshingUserIdRef.current === userId
        ) {
            return;
        }

        refreshingUserIdRef.current = userId;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        logAuthDiagnostic("session_refresh_started", {
            pathname,
            userId,
            accountStatus,
        });

        const timeout = new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => {
                logAuthDiagnostic("session_refresh_timeout", {
                    pathname,
                    userId,
                });
                resolve(null);
            }, 5_000);
        });

        Promise.race([updateSession(), timeout])
            .catch((err) => {
                logAuthDiagnostic("session_refresh_failed", {
                    pathname,
                    userId,
                    error: err,
                });
                console.error("[auth] Session refresh failed:", err);
            })
            .finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
                if (refreshingUserIdRef.current === userId) {
                    refreshingUserIdRef.current = null;
                    setFreshStatusCheckedForUserId(userId);
                    logAuthDiagnostic("session_refresh_finished", {
                        pathname,
                        userId,
                    });
                }
            });
    }, [accountStatus, freshStatusCheckedForUserId, pathname, status, updateSession, userId]);

    // Persist sticky approval once we've confirmed the user is APPROVED (or
    // a legacy session without explicit status — APPROVED is the assumed default).
    // The setState here is genuinely a downstream side effect of session
    // resolution and cannot be derived during render (sessionStorage write
    // requires browser, status field comes from useSession).
    useEffect(() => {
        if (status !== "authenticated" || !userId) return;
        if (!hasCheckedFreshStatus) return;
        if (accountStatus === "PENDING" || accountStatus === "REJECTED") return;
        if (approvedUserId === userId) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setApprovedUserId(userId);
        writeApprovedUserIdCache(userId);
    }, [accountStatus, approvedUserId, hasCheckedFreshStatus, status, userId]);

    // Account switch: clear stale approval if NextAuth resolves a different user.
    useEffect(() => {
        if (status !== "authenticated" || !userId) return;
        if (approvedUserId && approvedUserId !== userId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setApprovedUserId(null);
            writeApprovedUserIdCache(null);
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFreshStatusCheckedForUserId(null);
        }
    }, [approvedUserId, status, userId]);

    useEffect(() => {
        if (isBypassRoute || status !== "unauthenticated") return;
        if (unauthenticatedProbeRef.current) return;

        unauthenticatedProbeRef.current = true;
        logAuthDiagnostic("auth_redirect_probe_started", {
            reason: "session_status_unauthenticated",
            pathname,
        });

        void confirmAuthSessionMissing()
            .then((sessionMissing) => {
                logAuthDiagnostic("auth_redirect_probe_result", {
                    reason: "session_status_unauthenticated",
                    pathname,
                    sessionMissing,
                });

                if (!sessionMissing) {
                    setTimeout(() => {
                        updateSession().catch((err) => {
                            logAuthDiagnostic("session_refresh_failed", {
                                pathname,
                                error: err,
                            });
                        });
                    }, 1_000);
                    return;
                }

                // Confirmed: the server says the session is gone. Drop the
                // sticky approval cache so future renders don't keep showing
                // the protected UI from a phantom "approved" state.
                setApprovedUserId(null);
                writeApprovedUserIdCache(null);
                setFreshStatusCheckedForUserId(null);
                queryClient.clear();
                logAuthDiagnostic("unauthenticated_redirect", {
                    pathname,
                    callbackUrl: pathname,
                });

                const signInUrl = new URL("/auth/signin", window.location.origin);
                signInUrl.searchParams.set("callbackUrl", pathname);
                router.replace(signInUrl.toString());
            })
            .finally(() => {
                unauthenticatedProbeRef.current = false;
            });
    }, [isBypassRoute, pathname, queryClient, router, status, updateSession]);

    useEffect(() => {
        // Skip for bypass routes, unauthenticated users, and loading state
        if (isBypassRoute || status !== "authenticated") return;
        // Wait for session refresh before making decisions
        if (!hasCheckedFreshStatus) return;

        // Only redirect if status is explicitly PENDING or REJECTED
        if (accountStatus === "PENDING" || accountStatus === "REJECTED") {
            router.replace("/auth/waitlist");
        }
    }, [accountStatus, status, hasCheckedFreshStatus, isBypassRoute, pathname, router]);

    // Bypass routes always render children immediately (signin, waitlist, etc.)
    if (isBypassRoute) {
        return <>{children}</>;
    }

    // Sticky path: this tab has previously approved a user → keep rendering
    // children across `loading`/momentary `unauthenticated` flickers. The
    // probe-and-redirect effect above will still kick in if the session is
    // truly gone, but in the meantime we don't blow away the canvas editor
    // every time NextAuth chooses to re-fetch in the background.
    if (hasStickyApproval) {
        return <>{children}</>;
    }

    // Show spinner while session is loading, refreshing, or redirecting away.
    if (
        status === "loading" ||
        status === "unauthenticated" ||
        (status === "authenticated" && !hasCheckedFreshStatus)
    ) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Block rendering for explicitly non-approved authenticated users (prevent flash)
    if (status === "authenticated" && (accountStatus === "PENDING" || accountStatus === "REJECTED")) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return <>{children}</>;
}
