"use client";

/**
 * Figma Import Modal.
 *
 * Three-step flow:
 *   1. Paste a Figma URL / file key. We validate + preview (name, thumbnail) via tRPC.
 *   2. Confirm the target project name and import options.
 *   3. Progress screen with a polled status + final ImportReport summary.
 *
 * If the user hasn't connected Figma yet, we surface a "Connect Figma" CTA
 * that links to /settings/integrations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Plug,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { trpc } from "@/lib/trpc";
import type { ImportReport, LossyReason } from "@/lib/figma/types";

interface FigmaImportModalProps {
    open: boolean;
    onClose: () => void;
    workspaceId: string | null;
}

type Step = "input" | "confirm" | "running" | "done";

const LOSSY_LABELS: Record<LossyReason, string> = {
    gradient_fill_flattened: "Градиент сведён к доминирующему цвету",
    multiple_fills_flattened: "Несколько заливок сведены к одной",
    effect_ignored: "Эффекты (тени, блюр) проигнорированы",
    stroke_align_lost: "Тип выравнивания обводки потерян",
    baseline_align_lost: "Вертикальное выравнивание текста потеряно",
    justified_text_lost: "Justified-выравнивание заменено на left",
    mixed_text_styles_collapsed: "Смешанные стили текста сведены к одному",
    unsupported_text_decoration: "Декорация текста (underline/strikethrough) проигнорирована",
    unsupported_text_case: "Сложные text case проигнорированы",
    auto_layout_wrap_flattened: "Wrap-поведение auto-layout упрощено",
    vector_rasterized: "Векторы преобразованы в SVG/PNG",
    unsupported_node_type: "Тип ноды не поддерживается",
    image_fill_download_failed: "Не удалось скачать изображение",
};

export function FigmaImportModal({ open, onClose, workspaceId }: FigmaImportModalProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>("input");
    const [urlInput, setUrlInput] = useState("");
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [nodeId, setNodeId] = useState<string | undefined>(undefined);
    const [projectName, setProjectName] = useState("");
    const [importId, setImportId] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);

    const isConfigured = trpc.figma.isConfigured.useQuery(undefined, {
        enabled: open,
        staleTime: 5 * 60 * 1000,
    });
    const status = trpc.figma.connectionStatus.useQuery(undefined, {
        enabled: open && isConfigured.data === true,
    });

    const previewQuery = trpc.figma.previewFile.useQuery(
        fileKey ? { fileKey } : { fileKey: "" },
        { enabled: !!fileKey && step === "confirm" },
    );

    const importMutation = trpc.figma.importFile.useMutation();
    const statusQuery = trpc.figma.getImportStatus.useQuery(
        importId ? { importId } : { importId: "" },
        {
            enabled: !!importId && (step === "running" || step === "done"),
            refetchInterval: (query) => {
                const data = query.state.data;
                if (!data) return 2000;
                if (data.status === "COMPLETED" || data.status === "FAILED") return false;
                return 2000;
            },
        },
    );

    // ── Transition to "done" once worker reports a terminal state ──────────
    useEffect(() => {
        const s = statusQuery.data?.status;
        if (s === "COMPLETED" || s === "FAILED") {
            setStep("done");
        }
    }, [statusQuery.data?.status]);

    // Reset state when modal reopens.
    useEffect(() => {
        if (!open) {
            setStep("input");
            setUrlInput("");
            setFileKey(null);
            setNodeId(undefined);
            setProjectName("");
            setImportId(null);
            setFormError(null);
        }
    }, [open]);

    const utils = trpc.useUtils();
    const handleParse = useCallback(async () => {
        setFormError(null);
        const trimmed = urlInput.trim();
        if (!trimmed) {
            setFormError("Вставьте ссылку или ключ файла Figma");
            return;
        }
        try {
            const res = await utils.figma.parseFileUrl.fetch({ url: trimmed });
            if (!res.ok) {
                setFormError(res.error);
                return;
            }
            setFileKey(res.fileKey);
            setNodeId(res.nodeId);
            setStep("confirm");
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Не удалось обработать ссылку");
        }
    }, [urlInput, utils.figma.parseFileUrl]);

    const handleImport = useCallback(async () => {
        if (!workspaceId || !fileKey) return;
        try {
            const res = await importMutation.mutateAsync({
                workspaceId,
                fileKey,
                nodeId,
                projectName: projectName.trim() || previewQuery.data?.name || "Figma Import",
                sourceUrl: urlInput.trim() || undefined,
            });
            setImportId(res.importId);
            setStep("running");
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Не удалось запустить импорт");
        }
    }, [workspaceId, fileKey, nodeId, projectName, previewQuery.data?.name, urlInput, importMutation]);

    const report = useMemo<ImportReport | null>(() => {
        const raw = statusQuery.data?.report;
        if (!raw || typeof raw !== "object") return null;
        return raw as unknown as ImportReport;
    }, [statusQuery.data?.report]);

    const connected = status.data?.connected === true;

    // ── Render ──────────────────────────────────────────────────────────────
    const title =
        step === "running"
            ? "Импорт из Figma"
            : step === "done"
              ? statusQuery.data?.status === "COMPLETED"
                  ? "Готово"
                  : "Не удалось импортировать"
              : "Импорт из Figma";

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            maxWidth="max-w-xl"
            footer={renderFooter()}
        >
            {step === "input" && renderInputStep()}
            {step === "confirm" && renderConfirmStep()}
            {(step === "running" || step === "done") && renderProgressStep()}
        </Modal>
    );

    function renderFooter(): React.ReactNode {
        if (step === "input") {
            if (isConfigured.data === false) {
                return (
                    <>
                        <Button variant="secondary" size="md" onClick={onClose}>
                            Закрыть
                        </Button>
                    </>
                );
            }
            if (!connected) {
                return (
                    <>
                        <Button variant="secondary" size="md" onClick={onClose}>
                            Отмена
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            icon={<Plug size={14} />}
                            onClick={() => {
                                window.location.href = "/api/connect/figma/start?returnTo=%2Fprojects";
                            }}
                        >
                            Подключить Figma
                        </Button>
                    </>
                );
            }
            return (
                <>
                    <Button variant="secondary" size="md" onClick={onClose}>
                        Отмена
                    </Button>
                    <Button
                        variant="primary"
                        size="md"
                        icon={<ArrowRight size={14} />}
                        onClick={handleParse}
                        disabled={!urlInput.trim()}
                    >
                        Далее
                    </Button>
                </>
            );
        }
        if (step === "confirm") {
            return (
                <>
                    <Button variant="secondary" size="md" onClick={() => setStep("input")}>
                        Назад
                    </Button>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={handleImport}
                        disabled={importMutation.isPending || previewQuery.isLoading || !workspaceId}
                        icon={importMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    >
                        Начать импорт
                    </Button>
                </>
            );
        }
        if (step === "running") {
            return (
                <Button variant="secondary" size="md" onClick={onClose}>
                    Свернуть
                </Button>
            );
        }
        // done
        const projectId = statusQuery.data?.projectId;
        return (
            <>
                <Button variant="secondary" size="md" onClick={onClose}>
                    Закрыть
                </Button>
                {projectId ? (
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                            onClose();
                            router.push(`/editor/${projectId}`);
                        }}
                    >
                        Открыть проект
                    </Button>
                ) : null}
            </>
        );
    }

    function renderInputStep(): React.ReactNode {
        if (isConfigured.isLoading) {
            return (
                <div className="py-8 text-center text-text-secondary">
                    <Loader2 className="mx-auto animate-spin" size={20} />
                </div>
            );
        }
        if (isConfigured.data === false) {
            return (
                <div className="text-sm text-text-secondary">
                    Интеграция с Figma не настроена на этом деплое. Обратитесь к администратору и установите
                    переменные окружения <code>AUTH_FIGMA_ID / AUTH_FIGMA_SECRET</code>.
                </div>
            );
        }
        if (!connected) {
            return (
                <div className="text-sm text-text-secondary space-y-3">
                    <p>
                        Чтобы импортировать файлы, подключите ваш аккаунт Figma. Мы запрашиваем только
                        разрешение <code>files:read</code>.
                    </p>
                    <Link
                        href="https://www.figma.com/developers/api#oauth2"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-accent-primary hover:underline"
                    >
                        Подробнее об OAuth Figma <ExternalLink size={12} />
                    </Link>
                </div>
            );
        }
        return (
            <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                    Вставьте ссылку на Figma-файл или фрейм (ctrl/cmd+L → «Copy link»).
                </p>
                <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://www.figma.com/design/…"
                    autoFocus
                />
                {formError && (
                    <div className="flex items-start gap-2 text-xs text-red-500">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" /> {formError}
                    </div>
                )}
            </div>
        );
    }

    function renderConfirmStep(): React.ReactNode {
        if (previewQuery.isLoading) {
            return (
                <div className="py-8 text-center text-text-secondary">
                    <Loader2 className="mx-auto animate-spin" size={20} />
                    <p className="mt-2 text-xs">Получаем информацию о файле…</p>
                </div>
            );
        }
        if (previewQuery.isError) {
            return (
                <div className="text-sm text-red-500 flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <div>
                        Не удалось загрузить файл: {previewQuery.error?.message}. Убедитесь, что у вашего
                        Figma-аккаунта есть доступ к этому файлу.
                    </div>
                </div>
            );
        }
        const p = previewQuery.data;
        return (
            <div className="space-y-5">
                <div className="flex gap-4 items-start">
                    {p?.thumbnailUrl ? (
                        <Image
                            src={p.thumbnailUrl}
                            alt={p.name}
                            width={96}
                            height={72}
                            className="rounded-[var(--radius-md)] border border-border-primary object-cover"
                            unoptimized
                        />
                    ) : (
                        <div className="w-24 h-18 rounded-[var(--radius-md)] border border-border-primary bg-bg-tertiary" />
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p?.name}</p>
                        <p className="text-xs text-text-tertiary">
                            {p?.pages.length} стр. · обновлён{" "}
                            {p?.lastModified ? new Date(p.lastModified).toLocaleDateString("ru-RU") : "?"}
                        </p>
                        {nodeId && (
                            <p className="text-xs text-text-tertiary mt-1">
                                Импорт ограничен нодой <code>{nodeId}</code>
                            </p>
                        )}
                    </div>
                </div>
                <div>
                    <label className="block text-xs text-text-secondary mb-1.5">Название проекта</label>
                    <Input
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder={p?.name ?? "Figma Import"}
                    />
                </div>
                {formError && (
                    <div className="flex items-start gap-2 text-xs text-red-500">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" /> {formError}
                    </div>
                )}
                <p className="text-[11px] text-text-tertiary">
                    Векторные ноды будут сохранены как SVG-ассеты. Эффекты, градиенты и смешанные стили
                    текста могут быть упрощены — после импорта вы увидите подробный отчёт.
                </p>
            </div>
        );
    }

    function renderProgressStep(): React.ReactNode {
        const data = statusQuery.data;
        const isFailed = data?.status === "FAILED";
        const isCompleted = data?.status === "COMPLETED";

        const statusLabel = ((): string => {
            switch (data?.status) {
                case "PENDING":
                    return "В очереди…";
                case "FETCHING":
                    return "Загружаем файл из Figma…";
                case "MAPPING":
                    return "Конвертируем слои…";
                case "CREATING_PROJECT":
                    return "Создаём проект…";
                case "DOWNLOADING_ASSETS":
                    return "Скачиваем изображения…";
                case "COMPLETED":
                    return "Готово";
                case "FAILED":
                    return data.error ?? "Ошибка";
                default:
                    return "Инициализация…";
            }
        })();

        return (
            <div className="space-y-5">
                <div>
                    <div className="flex items-center justify-between text-xs text-text-secondary mb-2">
                        <span>{statusLabel}</span>
                        <span>{data?.progress ?? 0}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-bg-tertiary overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${
                                isFailed
                                    ? "bg-red-500"
                                    : isCompleted
                                      ? "bg-emerald-500"
                                      : "bg-accent-primary"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, data?.progress ?? 0))}%` }}
                        />
                    </div>
                </div>

                {isFailed && (
                    <div className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 rounded-[var(--radius-md)] p-3">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        <div>{data?.error ?? "Импорт завершился с ошибкой."}</div>
                    </div>
                )}

                {isCompleted && report && renderReport(report)}
            </div>
        );
    }

    function renderReport(rep: ImportReport): React.ReactNode {
        const { stats, warnings, skippedNodes } = rep;
        const groupedWarnings = warnings.reduce<Partial<Record<LossyReason, number>>>((acc, w) => {
            acc[w.reason] = (acc[w.reason] ?? 0) + 1;
            return acc;
        }, {});

        return (
            <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-emerald-500">
                    <CheckCircle2 size={16} /> Импорт завершён
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Слоёв" value={stats.layersCreated} />
                    <Stat label="Нод просмотрено" value={stats.nodesSeen} />
                    <Stat label="Страниц" value={stats.pagesSeen} />
                    <Stat label="Изображений скачано" value={stats.imagesDownloaded} />
                    <Stat
                        label="Изображений потеряно"
                        value={stats.imagesFailed}
                        tone={stats.imagesFailed > 0 ? "warn" : "default"}
                    />
                    <Stat label="Компонентов" value={stats.instancesCreated} />
                </div>

                {Object.keys(groupedWarnings).length > 0 && (
                    <details className="rounded-[var(--radius-md)] border border-border-primary p-3 text-xs">
                        <summary className="cursor-pointer text-text-secondary">
                            Ограничения конвертации: {warnings.length}
                        </summary>
                        <ul className="mt-2 space-y-1 text-text-tertiary">
                            {Object.entries(groupedWarnings).map(([reason, count]) => (
                                <li key={reason}>
                                    · {LOSSY_LABELS[reason as LossyReason] ?? reason} — {count}
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

                {skippedNodes.length > 0 && (
                    <details className="rounded-[var(--radius-md)] border border-border-primary p-3 text-xs">
                        <summary className="cursor-pointer text-text-secondary">
                            Пропущенные ноды: {skippedNodes.length}
                        </summary>
                        <ul className="mt-2 space-y-1 text-text-tertiary">
                            {skippedNodes.slice(0, 20).map((n) => (
                                <li key={n.nodeId}>
                                    · {n.nodeName || "(без имени)"} ({n.nodeType})
                                </li>
                            ))}
                            {skippedNodes.length > 20 && <li>…и ещё {skippedNodes.length - 20}</li>}
                        </ul>
                    </details>
                )}
            </div>
        );
    }
}

function Stat({
    label,
    value,
    tone = "default",
}: {
    label: string;
    value: number;
    tone?: "default" | "warn";
}) {
    return (
        <div className="rounded-[var(--radius-md)] bg-bg-tertiary px-2.5 py-2">
            <div className={tone === "warn" ? "text-amber-500 text-sm font-medium" : "text-text-primary text-sm font-medium"}>
                {value}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
        </div>
    );
}
