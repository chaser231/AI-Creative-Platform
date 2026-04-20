"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc";

const STATUS_MESSAGES: Record<string, { type: "success" | "error"; text: string }> = {
    connected: { type: "success", text: "Figma успешно подключена" },
    unauthenticated: { type: "error", text: "Нужно войти в систему, чтобы подключить Figma" },
    missing_code: { type: "error", text: "Не пришёл код авторизации от Figma" },
    missing_state: { type: "error", text: "Не найден CSRF state. Попробуйте ещё раз." },
    bad_state: { type: "error", text: "Некорректный CSRF state. Попробуйте ещё раз." },
    state_mismatch: { type: "error", text: "CSRF state не совпал. Попробуйте ещё раз." },
    user_mismatch: { type: "error", text: "Сессия изменилась во время подключения." },
    token_exchange_failed: { type: "error", text: "Не удалось обменять код на токен." },
    missing_user_id: { type: "error", text: "Figma не вернула user_id." },
    save_failed: { type: "error", text: "Не удалось сохранить подключение." },
};

export default function IntegrationsSettingsPage() {
    const params = useSearchParams();
    const figmaParam = params.get("figma") ?? "";
    const statusMessage = STATUS_MESSAGES[figmaParam];

    const isConfigured = trpc.figma.isConfigured.useQuery(undefined, {
        staleTime: 5 * 60 * 1000,
    });
    const status = trpc.figma.connectionStatus.useQuery(undefined, {
        enabled: isConfigured.data === true,
    });
    const me = trpc.figma.me.useQuery(undefined, {
        enabled: status.data?.connected === true,
        retry: false,
    });
    const disconnect = trpc.figma.disconnect.useMutation({
        onSuccess: () => {
            status.refetch();
            me.refetch();
        },
    });

    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    const connected = status.data?.connected === true;

    const expiresAtLabel = useMemo(() => {
        const expiresAt = status.data?.expiresAt;
        if (!expiresAt) return null;
        try {
            return new Date(expiresAt).toLocaleString("ru-RU");
        } catch {
            return null;
        }
    }, [status.data]);

    return (
        <AppShell>
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-2xl mx-auto">
                    <Link
                        href="/settings"
                        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-4"
                    >
                        <ArrowLeft size={16} /> Все настройки
                    </Link>
                    <h1 className="text-2xl font-light text-text-primary mb-1">Интеграции</h1>
                    <p className="text-sm text-text-secondary mb-8">
                        Подключите внешние сервисы для импорта и синхронизации данных
                    </p>

                    {statusMessage && (
                        <div
                            className={`mb-6 rounded-[var(--radius-lg)] border p-3 text-sm ${
                                statusMessage.type === "success"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                    : "border-red-500/30 bg-red-500/10 text-red-500"
                            }`}
                        >
                            {statusMessage.text}
                        </div>
                    )}

                    {/* Figma card */}
                    <section className="rounded-[var(--radius-xl)] border border-border-primary bg-bg-surface p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-[var(--radius-lg)] bg-[#1e1e1e] flex items-center justify-center shrink-0">
                                <FigmaGlyph />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-base font-medium text-text-primary">Figma</h2>
                                    {connected ? (
                                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">
                                            <Check size={12} /> Подключено
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                                            Не подключено
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary mt-1">
                                    Импортируйте фреймы из Figma-файлов как проекты платформы. Поддерживаются
                                    фреймы, группы, auto-layout, тексты, изображения и компоненты.
                                </p>

                                {connected && (
                                    <div className="mt-4 space-y-1 text-xs text-text-secondary">
                                        {me.data?.handle && (
                                            <p>
                                                Аккаунт: <span className="text-text-primary">{me.data.handle}</span>
                                                {me.data.email && (
                                                    <span className="text-text-tertiary"> · {me.data.email}</span>
                                                )}
                                            </p>
                                        )}
                                        {expiresAtLabel && (
                                            <p>Токен действителен до: {expiresAtLabel}</p>
                                        )}
                                        {status.data?.scope && (
                                            <p>Scope: <code className="font-mono">{status.data.scope}</code></p>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 flex items-center gap-3">
                                    {isConfigured.data === false ? (
                                        <p className="text-xs text-amber-500">
                                            Интеграция не настроена на этом деплое. Установите{" "}
                                            <code>AUTH_FIGMA_ID / AUTH_FIGMA_SECRET</code>.
                                        </p>
                                    ) : !connected ? (
                                        <>
                                            <Button
                                                onClick={() => {
                                                    window.location.href = "/api/connect/figma/start";
                                                }}
                                                variant="primary"
                                                size="sm"
                                                icon={<Plug size={14} />}
                                            >
                                                Подключить Figma
                                            </Button>
                                            <a
                                                href="https://www.figma.com/developers/api#authentication"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-text-secondary hover:text-text-primary inline-flex items-center gap-1"
                                            >
                                                Подробнее <ExternalLink size={12} />
                                            </a>
                                        </>
                                    ) : confirmDisconnect ? (
                                        <>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => disconnect.mutate()}
                                                disabled={disconnect.isPending}
                                                icon={disconnect.isPending ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                                            >
                                                Подтвердить отключение
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setConfirmDisconnect(false)}
                                            >
                                                Отмена
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => setConfirmDisconnect(true)}
                                            icon={<Unplug size={14} />}
                                        >
                                            Отключить
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </AppShell>
    );
}

function FigmaGlyph() {
    return (
        <svg viewBox="0 0 38 57" width="18" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0Z" fill="#1abcfe" />
            <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0Z" fill="#0acf83" />
            <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19Z" fill="#ff7262" />
            <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#f24e1e" />
            <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#a259ff" />
        </svg>
    );
}
