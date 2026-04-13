"use client";

/**
 * WaitlistGuard
 *
 * Client-side redirect component that checks the user's account status.
 * - PENDING/REJECTED → redirect to /auth/waitlist
 * - APPROVED → render children normally
 * - Not authenticated → skip (middleware handles redirect to signin)
 *
 * Wraps the main app layout to enforce waitlist before any platform access.
 */

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

// Routes that bypass the waitlist guard
const BYPASS_ROUTES = [
    "/auth/signin",
    "/auth/waitlist",
    "/auth/error",
    "/api/",
];

export function WaitlistGuard({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const pathname = usePathname();
    const router = useRouter();

    const accountStatus = session?.user?.status;
    const isBypassRoute = BYPASS_ROUTES.some((route) => pathname.startsWith(route));

    useEffect(() => {
        // Skip for bypass routes, unauthenticated users, and loading state
        if (isBypassRoute || status !== "authenticated") return;

        // Redirect non-approved users to waitlist
        if (accountStatus && accountStatus !== "APPROVED") {
            router.replace("/auth/waitlist");
        }
    }, [accountStatus, status, isBypassRoute, pathname, router]);

    // Bypass routes always render children immediately (signin, waitlist, etc.)
    if (isBypassRoute) {
        return <>{children}</>;
    }

    // Show spinner while session is loading (prevents flash of dashboard)
    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Block rendering for non-approved authenticated users (prevent flash)
    if (status === "authenticated" && accountStatus && accountStatus !== "APPROVED") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return <>{children}</>;
}
