"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInContent() {
    const [isLoading, setIsLoading] = useState(false);
    const searchParams = useSearchParams();
    const error = searchParams.get("error");
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    const errorMessages: Record<string, string> = {
        Configuration: "Ошибка конфигурации сервера. Проверьте env-переменные.",
        AccessDenied: "Доступ запрещён. Обратитесь к администратору.",
        Verification: "Ошибка верификации. Попробуйте ещё раз.",
        Default: "Произошла ошибка при входе. Попробуйте ещё раз.",
    };

    const handleSignIn = () => {
        setIsLoading(true);
        signIn("yandex", { callbackUrl });
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-bg-canvas">
            <div className="w-full max-w-sm mx-auto">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg mb-6">
                        <span className="text-2xl">🔥</span>
                    </div>
                    <h1 className="text-2xl font-semibold text-text-primary">
                        AI Creative Platform
                    </h1>
                    <p className="text-sm text-text-tertiary mt-2">
                        Войдите, чтобы начать создавать креативы
                    </p>
                </div>

                {/* Error message */}
                {error && (
                    <div className="mb-4 p-3 rounded-xl border border-red-200 dark:border-red-800/30 bg-red-50 dark:bg-red-950/20">
                        <p className="text-[12px] text-red-700 dark:text-red-400 text-center">
                            ⚠️ {errorMessages[error] || errorMessages.Default}
                        </p>
                    </div>
                )}

                {/* Sign-in card */}
                <div className="bg-bg-surface border border-border-primary rounded-2xl p-6 shadow-sm">
                    <button
                        onClick={handleSignIn}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-3 h-12 rounded-xl bg-[#FC3F1D] hover:bg-[#E5391A] text-white font-medium text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-sm hover:shadow-md"
                    >
                        {/* Yandex logo */}
                        <svg width="20" height="20" viewBox="0 0 44 44" fill="none">
                            <path d="M24.8 38H29.2V6H23.6C15.6 6 11.4 10.2 11.4 16.2C11.4 21.2 13.8 23.8 17.8 26.6L11 38H15.8L23.4 25.6L20.8 24C17.4 21.6 15.6 19.6 15.6 15.8C15.6 12.2 18 9.6 23.6 9.6H24.8V38Z" fill="white"/>
                        </svg>
                        {isLoading ? "Входим..." : "Войти через Яндекс"}
                    </button>

                    <div className="mt-4 text-center">
                        <p className="text-[11px] text-text-tertiary">
                            Используется Yandex OAuth для безопасной аутентификации
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function SignInPage() {
    return (
        <Suspense>
            <SignInContent />
        </Suspense>
    );
}
