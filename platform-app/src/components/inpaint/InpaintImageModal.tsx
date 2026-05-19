/**
 * InpaintImageModal — surface-agnostic modal that lets the user paint a mask
 * over a source image and trigger an "edit" / "remove" inpaint via the shared
 * /api/ai/image-edit endpoint.
 *
 * This component is reused by:
 *   • PhotoInpaintModal — wraps it for the Photo workspace and adds chat
 *     message + asset save side-effects.
 *   • WizardInpaintModal — wraps it for the Wizard layer prompt bar and
 *     pushes the result back into the active layer.
 *
 * The modal owns its own `useInpaintMask` hook instance — it does NOT
 * consume the shared InpaintProvider. Modal lifecycle is bound to the `open`
 * prop, so strokes never persist between separate inpaint sessions.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Sparkles, Maximize2 } from "lucide-react";
import { useInpaintMask } from "@/hooks/useInpaintMask";
import { InpaintMaskOverlay } from "@/components/inpaint/InpaintMaskOverlay";
import { InpaintActionBar, type InpaintAction } from "@/components/inpaint/InpaintActionBar";
import { uploadForAI } from "@/utils/imageUpload";
import { getModelById } from "@/lib/ai-models";
import { DEFAULT_INPAINT_MODEL, PREFERRED_INPAINT_MODELS } from "@/lib/inpaintPrompts";
import { SelectPill } from "@/components/ui/SelectPill";
import { parseGenerationError } from "@/lib/parseGenerationError";

export interface InpaintApplyMeta {
    model: string;
    intent: InpaintAction;
    prompt: string;
}

export interface InpaintImageModalProps {
    open: boolean;
    sourceUrl: string;
    projectId: string;
    /**
     * Called after the API returns the new image URL but BEFORE persisting
     * to S3 — wrappers may want to persist + save asset themselves.
     * The hook returns the URL it considers canonical for the layer (usually
     * the persisted URL). Returning a string overrides what we set as the
     * final result. If undefined/void is returned, the raw URL is used.
     */
    onApply: (rawUrl: string, meta: InpaintApplyMeta) => string | void | Promise<string | void>;
    onClose: () => void;
    defaultModel?: string;
    title?: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
        reader.readAsDataURL(blob);
    });
}

export function InpaintImageModal({
    open,
    sourceUrl,
    projectId,
    onApply,
    onClose,
    defaultModel,
    title = "AI Inpaint",
}: InpaintImageModalProps) {
    const mask = useInpaintMask({ initialBrushSize: 32 });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [bbox, setBbox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [model, setModel] = useState<string>(defaultModel ?? DEFAULT_INPAINT_MODEL);
    const [prompt, setPrompt] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStage, setProcessingStage] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Recompute image bbox on resize / image load.
    useEffect(() => {
        if (!open) return;
        const container = containerRef.current;
        const img = imageRef.current;
        if (!container || !img) return;

        const compute = () => {
            const cRect = container.getBoundingClientRect();
            const iRect = img.getBoundingClientRect();
            setBbox({
                left: iRect.left - cRect.left,
                top: iRect.top - cRect.top,
                width: iRect.width,
                height: iRect.height,
            });
        };
        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(container);
        ro.observe(img);
        return () => ro.disconnect();
    }, [open, natural]);

    // Reset state on close — never carry strokes / prompts between sessions.
    useEffect(() => {
        if (!open) {
            mask.clear();
            setPrompt("");
            setErrorMsg(null);
            setProcessingStage(null);
            setNatural(null);
            setBbox(null);
        }
        // mask.clear is stable; safe to omit
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleAction = useCallback(async (intent: InpaintAction) => {
        if (!projectId || !sourceUrl) return;
        if (!mask.hasMask) {
            setErrorMsg("Нарисуйте маску по области редактирования.");
            return;
        }
        if (intent === "edit" && !prompt.trim()) {
            setErrorMsg("Для Правки введите промпт.");
            return;
        }

        const naturalSize = natural ?? { w: bbox?.width ?? 1024, h: bbox?.height ?? 1024 };
        const modelEntry = getModelById(model);
        setIsProcessing(true);
        setProcessingStage("Готовим маску…");
        setErrorMsg(null);
        const clientStartedAt = performance.now();
        try {
            const blob = await mask.exportMaskBlob(
                {
                    naturalWidth: naturalSize.w,
                    naturalHeight: naturalSize.h,
                    layerWidth: bbox?.width ?? naturalSize.w,
                    layerHeight: bbox?.height ?? naturalSize.h,
                    objectFit: "contain",
                    zoom: 1,
                },
                modelEntry?.slug,
            );
            if (!blob) {
                throw new Error("Маска пуста — нарисуйте кистью область для inpaint.");
            }

            const maskDataUrl = await blobToDataUrl(blob);
            setProcessingStage("Загружаем изображение и маску…");
            const uploadStartedAt = performance.now();
            const [imageUrl, maskUrl] = await Promise.all([
                uploadForAI(sourceUrl, projectId),
                uploadForAI(maskDataUrl, projectId),
            ]);
            console.info("[InpaintImageModal] uploads done", {
                model,
                uploadMs: Math.round(performance.now() - uploadStartedAt),
                naturalSize,
            });

            const genHint =
                model === "gpt-image-2"
                    ? "GPT Image 2 — обычно 1–3 мин"
                    : model === "flux-fill"
                      ? "FLUX Fill — обычно 15–45 сек"
                      : "Генерация может занять до 2 мин";
            setProcessingStage(`Генерируем (${genHint})…`);

            const apiStartedAt = performance.now();
            const response = await fetch("/api/ai/image-edit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "inpaint",
                    intent,
                    prompt: intent === "remove" ? "" : prompt,
                    imageBase64: imageUrl,
                    maskBase64: maskUrl,
                    model,
                    projectId,
                    scale: "high",
                    recordMessage: false,
                }),
            });
            const data = await response.json();
            if (data.error || !data.content) {
                throw new Error(data.error || "Пустой ответ от модели");
            }
            console.info("[InpaintImageModal] API done", {
                model: data.model ?? model,
                apiMs: Math.round(performance.now() - apiStartedAt),
                totalMs: Math.round(performance.now() - clientStartedAt),
            });

            setProcessingStage("Сохраняем результат…");
            await onApply(data.content as string, {
                model: (data.model as string | undefined) ?? model,
                intent,
                prompt,
            });

            mask.clear();
            onClose();
        } catch (e: unknown) {
            console.error("[InpaintImageModal] inpaint failed", e);
            setErrorMsg(parseGenerationError(e));
        } finally {
            setIsProcessing(false);
            setProcessingStage(null);
        }
    }, [projectId, sourceUrl, mask, prompt, natural, bbox, model, onApply, onClose]);

    if (!open) return null;

    const inpaintModels = PREFERRED_INPAINT_MODELS
        .map((id) => {
            const entry = getModelById(id);
            return entry ? { value: id, label: entry.label } : null;
        })
        .filter((m): m is { value: string; label: string } => !!m);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
            <div className="bg-bg-primary rounded-2xl shadow-[var(--shadow-xl)] border border-border-primary w-[1100px] max-w-[96vw] max-h-[92vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <Sparkles size={18} className="text-text-secondary" />
                        {title}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-bg-secondary text-text-secondary transition-colors cursor-pointer"
                        title="Закрыть"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-[1fr_300px] gap-0">
                    <div
                        ref={containerRef}
                        className="relative bg-bg-tertiary flex items-center justify-center overflow-hidden"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={imageRef}
                            src={sourceUrl}
                            alt="inpaint source"
                            className="max-h-[80vh] max-w-full object-contain select-none pointer-events-none"
                            onLoad={(e) => {
                                const img = e.currentTarget;
                                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                            }}
                        />
                        {bbox && (
                            <InpaintMaskOverlay bbox={bbox} mask={mask} disabled={isProcessing} />
                        )}
                        {isProcessing && (
                            <div className="absolute inset-0 z-50 bg-black/30 flex items-center justify-center">
                                <div className="bg-bg-primary/95 backdrop-blur-sm rounded-[var(--radius-xl)] p-5 flex flex-col items-center gap-2 shadow-[var(--shadow-lg)]">
                                    <Loader2 size={28} className="animate-spin text-text-secondary" />
                                    <p className="text-xs font-medium text-text-primary text-center max-w-[220px]">
                                        {processingStage ?? "Применяю изменения…"}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-l border-border-primary bg-bg-secondary flex flex-col">
                        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                            <div>
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Модель</p>
                                <SelectPill
                                    label="Модель"
                                    value={model}
                                    onChange={setModel}
                                    options={inpaintModels}
                                    className="w-full"
                                />
                                {model === "flux-fill" && (
                                    <p className="text-[10px] text-text-tertiary mt-1">
                                        Рекомендуем по умолчанию: быстрее всего и с нативной поддержкой маски.
                                    </p>
                                )}
                                {model === "gpt-image-2" && (
                                    <p className="text-[10px] text-amber-600 mt-1">
                                        Премиум-качество, но генерация заметно дольше (часто 1–3 мин). Для быстрого результата выберите FLUX Fill.
                                    </p>
                                )}
                                {(model === "nano-banana" || model === "nano-banana-2" || model === "nano-banana-pro") && (
                                    <p className="text-[10px] text-amber-500 mt-1">
                                        Маска для Nano Banana — экспериментальная (модель использует её как подсказку).
                                    </p>
                                )}
                            </div>

                            <div>
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Промпт (для Правки)</p>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Что нарисовать в выделенной области?"
                                    className="w-full h-24 px-3 py-2 text-sm rounded-[var(--radius-md)] border border-border-primary bg-bg-primary text-text-primary placeholder:text-text-tertiary/60 focus:outline-none focus:border-border-focus resize-none"
                                />
                            </div>

                            {errorMsg && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-[var(--radius-sm)] p-2.5">
                                    <p className="text-[11px] text-red-500 leading-relaxed font-medium">{errorMsg}</p>
                                </div>
                            )}

                            <div className="flex items-start gap-2 p-2.5 rounded-[var(--radius-sm)] bg-bg-tertiary/60 border border-border-primary/60">
                                <Maximize2 size={12} className="text-text-tertiary mt-0.5 shrink-0" />
                                <p className="text-[10px] text-text-tertiary leading-relaxed">
                                    Рисуйте по области, которую нужно изменить. «Правка» использует промпт, «Удалить» убирает объект без промпта.
                                </p>
                            </div>
                        </div>

                        <div className="p-4 border-t border-border-primary">
                            <InpaintActionBar
                                mask={mask}
                                onAction={(action) => void handleAction(action)}
                                disabled={isProcessing}
                                editDisabled={!prompt.trim()}
                                editDisabledHint="Введите промпт, чтобы Правка стала активной"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
