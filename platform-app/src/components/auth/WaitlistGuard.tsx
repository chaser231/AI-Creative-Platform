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
import { useEffect, useState, type ReactNode } from "react";

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
    const [hasRefreshed, setHasRefreshed] = useState(false);

    const accountStatus = session?.user?.status;
    const isBypassRoute = BYPASS_ROUTES.some((route) => pathname.startsWith(route));

    // Force-refresh session once on mount to get fresh status from DB
    // This handles stale cached sessions that don't include the status field
    useEffect(() => {
        if (status === "authenticated" && !hasRefreshed) {
            setHasRefreshed(true);
            updateSession();
        }
    }, [status, hasRefreshed, updateSession]);

    useEffect(() => {
        // Skip for bypass routes, unauthenticated users, and loading state
        if (isBypassRoute || status !== "authenticated") return;
        // Wait for session refresh before making decisions
        if (!hasRefreshed) return;

        // Only redirect if status is explicitly PENDING or REJECTED
        if (accountStatus === "PENDING" || accountStatus === "REJECTED") {
            router.replace("/auth/waitlist");
        }
    }, [accountStatus, status, hasRefreshed, isBypassRoute, pathname, router]);

    // Bypass routes always render children immediately (signin, waitlist, etc.)
    if (isBypassRoute) {
        return <>{children}</>;
    }

    // Show spinner while session is loading or refreshing
    if (status === "loading" || (status === "authenticated" && !hasRefreshed)) {
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
