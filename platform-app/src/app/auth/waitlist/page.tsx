"use client";

/**
 * Waitlist Page — /auth/waitlist
 *
 * Shown to users whose account status is PENDING or REJECTED.
 * Auto-polls for status changes every 30 seconds.
 * Redirects to dashboard when approved.
 */

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { Clock, XCircle, LogOut, RefreshCw } from "lucide-react";
import { useSignOutAndClearState } from "@/hooks/useSignOutAndClearState";
import { confirmAuthSessionMissing } from "@/lib/authClient";

export default function WaitlistPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus, update: updateSession } = useSession();
    const signOutAndClearState = useSignOutAndClearState();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasRefreshedOnce, setHasRefreshedOnce] = useState(false);
    const [isCheckingUnauthenticated, setIsCheckingUnauthenticated] = useState(false);
    const refreshStartedRef = useRef(false);
    const unauthenticatedProbeRef = useRef(false);

    const accountStatus = session?.user?.status;

    // Force-refresh session on first mount to get fresh status from DB
    useEffect(() => {
        if (sessionStatus === "authenticated" && !refreshStartedRef.current) {
            refreshStartedRef.current = true;
            updateSession()
                .catch((err) => {
                    console.error("[auth] Session refresh failed:", err);
                })
                .finally(() => setHasRefreshedOnce(true));
        }
    }, [sessionStatus, updateSession]);

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus !== "unauthenticated") return;
        if (unauthenticatedProbeRef.current) return;

        unauthenticatedProbeRef.current = true;
        queueMicrotask(() => setIsCheckingUnauthenticated(true));
        confirmAuthSessionMissing()
            .then(async (sessionMissing) => {
                if (sessionMissing) {
                    router.replace("/auth/signin");
                    return;
                }

                await new Promise((resolve) => setTimeout(resolve, 1_000));
                await updateSession().catch((err) => {
                    console.error("[auth] Session refresh failed:", err);
                });
            })
            .finally(() => {
                unauthenticatedProbeRef.current = false;
                setIsCheckingUnauthenticated(false);
            });
    }, [sessionStatus, router, updateSession]);

    // Redirect to dashboard if approved (or if status is missing — legacy session)
    useEffect(() => {
        if (sessionStatus !== "authenticated" || !hasRefreshedOnce) return;
        // If status is APPROVED or undefined (pre-waitlist session), let them through
        if (!accountStatus || accountStatus === "APPROVED") {
            router.replace("/");
        }
    }, [accountStatus, sessionStatus, hasRefreshedOnce, router]);

    // Auto-poll session every 30 seconds to detect status change
    useEffect(() => {
        if (!accountStatus || accountStatus === "APPROVED") return;

        const interval = setInterval(async () => {
            await updateSession();
        }, 30_000);

        return () => clearInterval(interval);
    }, [accountStatus, updateSession]);

    // Manual refresh
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await updateSession();
        setTimeout(() => setIsRefreshing(false), 1000);
    }, [updateSession]);

    // Handle sign out
    const handleSignOut = () => {
        signOutAndClearState();
    };

    const isRejected = accountStatus === "REJECTED";

    if (sessionStatus === "loading" || isCheckingUnauthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
            <div className="w-full max-w-md mx-auto px-4">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg mb-6">
                        <span className="text-2xl">🔥</span>
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        AI Creative Platform
                    </h1>
                </div>

                {/* Status Card */}
                <div className="bg-bg-surface border border-border-primary rounded-2xl p-8 shadow-sm">
                    {isRejected ? (
                        /* Rejected state */
                        <>
                            <div className="flex justify-center mb-5">
                                <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
                                    <XCircle size={32} className="text-red-400" />
                                </div>
                            </div>
                            <h2 className="text-lg font-semibold text-text-primary text-center mb-2">
                                Заявка отклонена
                            </h2>
                            <p className="text-sm text-text-tertiary text-center leading-relaxed mb-6">
                                К сожалению, ваша заявка на доступ к платформе была отклонена администратором.
                                Если вы считаете, что это ошибка, обратитесь к администратору вашей организации.
                            </p>
                        </>
                    ) : (
                        /* Pending state */
                        <>
                            <div className="flex justify-center mb-5">
                                <div className="relative w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                                    <Clock size={32} className="text-amber-400" />
                                    {/* Pulse animation */}
                                    <div className="absolute inset-0 rounded-2xl bg-amber-500/5 animate-ping" style={{ animationDuration: "3s" }} />
                                </div>
                            </div>
                            <h2 className="text-lg font-semibold text-text-primary text-center mb-2">
                                Заявка на рассмотрении
                            </h2>
                            <p className="text-sm text-text-tertiary text-center leading-relaxed mb-2">
                                Ваш аккаунт создан и ожидает одобрения администратора.
                                Вы получите доступ к платформе после проверки.
                            </p>
                            <p className="text-[11px] text-text-tertiary text-center mb-6">
                                Страница обновляется автоматически
                            </p>

                            {/* User info */}
                            {session?.user && (
                                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-secondary border border-border-primary mb-6">
                                    {session.user.image ? (
                                        <img
                                            src={session.user.image}
                                            alt=""
                                            className="w-10 h-10 rounded-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-full bg-accent-primary/10 flex items-center justify-center text-accent-primary font-semibold">
                                            {session.user.name?.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-text-primary truncate">
                                            {session.user.name}
                                        </p>
                                        <p className="text-xs text-text-tertiary truncate">
                                            {session.user.email}
                                        </p>
                                    </div>
                                    <span className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-semibold">
                                        Ожидание
                                    </span>
                                </div>
                            )}
                        </>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                        {!isRejected && (
                            <button
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-border-primary bg-bg-secondary hover:bg-bg-tertiary text-sm text-text-secondary transition-colors disabled:opacity-50 cursor-pointer"
                            >
                                <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
                                {isRefreshing ? "Обновляем..." : "Проверить статус"}
                            </button>
                        )}
                        <button
                            onClick={handleSignOut}
                            className={`${isRejected ? "flex-1" : ""} flex items-center justify-center gap-2 h-10 px-5 rounded-xl border border-border-primary bg-bg-secondary hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 text-sm text-text-secondary transition-colors cursor-pointer`}
                        >
                            <LogOut size={14} />
                            Выйти
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-[11px] text-text-tertiary mt-6">
                    Если у вас есть вопросы, обратитесь к администратору платформы
                </p>
            </div>
        </div>
    );
}
