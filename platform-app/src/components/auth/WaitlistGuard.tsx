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
 */

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logAuthDiagnostic } from "@/lib/authDiagnostics";

// Routes that bypass the waitlist guard
const BYPASS_ROUTES = [
    "/auth/signin",
    "/auth/waitlist",
    "/auth/error",
    "/api/",
];

export function WaitlistGuard({ children }: { children: ReactNode }) {
    const { data: session, status, update: updateSession } = useSession();
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [freshStatusCheckedForUserId, setFreshStatusCheckedForUserId] = useState<string | null>(null);
    const refreshingUserIdRef = useRef<string | null>(null);
    const previousStatusRef = useRef<string | null>(null);

    const accountStatus = session?.user?.status;
    const userId = session?.user?.id ?? null;
    const isBypassRoute = BYPASS_ROUTES.some((route) => pathname.startsWith(route));
    const hasCheckedFreshStatus = status === "authenticated" && freshStatusCheckedForUserId === userId;

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

    useEffect(() => {
        if (isBypassRoute || status !== "unauthenticated") return;

        queryClient.clear();
        logAuthDiagnostic("unauthenticated_redirect", {
            pathname,
            callbackUrl: pathname,
        });

        const signInUrl = new URL("/auth/signin", window.location.origin);
        signInUrl.searchParams.set("callbackUrl", pathname);
        router.replace(signInUrl.toString());
    }, [isBypassRoute, pathname, queryClient, router, status]);

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
