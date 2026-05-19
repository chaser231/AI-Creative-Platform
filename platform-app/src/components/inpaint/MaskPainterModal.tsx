/**
 * MaskPainterModal — strips the InpaintImageModal down to its brush surface.
 *
 * Unlike InpaintImageModal, this modal does NOT call /api/ai/image-edit. It
 * just lets the user paint a mask over a source image, then uploads the
 * exported PNG (in the source image's natural pixel size) to S3 and returns
 * the resulting URL via `onSave`. Used by:
 *
 *   • Workflow paintMask node — stores the mask URL in node params so the
 *     `aiInpaint` downstream can consume it via the `mask-in` port.
 *
 * Mask format: matches whatever the downstream inpaint model expects — for
 * `flux-fill` we emit a white-on-black RGB PNG; for `openai/*` (gpt-image-2)
 * we emit an alpha PNG. Since `paintMask` is provider-agnostic at write time
 * we always emit the alpha format (works with both flux-fill and gpt-image-2;
 * flux-fill simply reads the alpha channel as white).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Brush, Maximize2 } from "lucide-react";
import { useInpaintMask } from "@/hooks/useInpaintMask";
import { InpaintMaskOverlay } from "@/components/inpaint/InpaintMaskOverlay";
import { uploadForAI } from "@/utils/imageUpload";
import { parseGenerationError } from "@/lib/parseGenerationError";

export interface MaskPainterModalProps {
    open: boolean;
    sourceUrl: string;
    projectId?: string;
    onSave: (maskUrl: string) => void | Promise<void>;
    onClose: () => void;
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

export function MaskPainterModal({
    open,
    sourceUrl,
    projectId = "ai-tmp",
    onSave,
    onClose,
    title = "Нарисовать маску",
}: MaskPainterModalProps) {
    const mask = useInpaintMask({ initialBrushSize: 36 });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [bbox, setBbox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

    useEffect(() => {
        if (!open) {
            mask.clear();
            setErrorMsg(null);
            setNatural(null);
            setBbox(null);
        }
        // mask.clear is stable
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleSave = useCallback(async () => {
        if (!sourceUrl) return;
        if (!mask.hasMask) {
            setErrorMsg("Нарисуйте маску по области редактирования.");
            return;
        }

        const naturalSize = natural ?? { w: bbox?.width ?? 1024, h: bbox?.height ?? 1024 };
        setIsProcessing(true);
        setErrorMsg(null);
        try {
            // Force alpha PNG — works with both flux-fill (reads alpha as
            // mask) and gpt-image-2 (requires alpha channel).
            const blob = await mask.exportMaskBlob(
                {
                    naturalWidth: naturalSize.w,
                    naturalHeight: naturalSize.h,
                    layerWidth: bbox?.width ?? naturalSize.w,
                    layerHeight: bbox?.height ?? naturalSize.h,
                    objectFit: "contain",
                    zoom: 1,
                },
                "openai/gpt-image-2",
            );
            if (!blob) throw new Error("Маска пуста — нарисуйте кистью область.");

            const dataUrl = await blobToDataUrl(blob);
            const uploaded = await uploadForAI(dataUrl, projectId);
            await onSave(uploaded);

            mask.clear();
            onClose();
        } catch (e: unknown) {
            console.error("[MaskPainterModal] save failed", e);
            setErrorMsg(parseGenerationError(e));
        } finally {
            setIsProcessing(false);
        }
    }, [sourceUrl, mask, natural, bbox, projectId, onSave, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
            <div className="bg-bg-primary rounded-2xl shadow-[var(--shadow-xl)] border border-border-primary w-[1100px] max-w-[96vw] max-h-[92vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <Brush size={18} className="text-text-secondary" />
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

                <div className="flex-1 min-h-0 grid grid-cols-[1fr_280px] gap-0">
                    <div
                        ref={containerRef}
                        className="relative bg-bg-tertiary flex items-center justify-center overflow-hidden"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            ref={imageRef}
                            src={sourceUrl}
                            alt="mask source"
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
                                    <p className="text-xs font-medium text-text-primary">Сохраняю маску...</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-l border-border-primary bg-bg-secondary flex flex-col">
                        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                            <div className="flex items-start gap-2 p-2.5 rounded-[var(--radius-sm)] bg-bg-tertiary/60 border border-border-primary/60">
                                <Maximize2 size={12} className="text-text-tertiary mt-0.5 shrink-0" />
                                <p className="text-[10px] text-text-tertiary leading-relaxed">
                                    Закрасьте кистью область, которую вы хотите изменить. Маска будет передана в ноду <strong>AI Inpaint</strong>.
                                </p>
                            </div>

                            <div>
                                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Размер кисти</p>
                                <input
                                    type="range"
                                    min={8}
                                    max={120}
                                    value={mask.brushSize}
                                    onChange={(e) => mask.setBrushSize(Number(e.target.value))}
                                    className="w-full accent-accent-primary"
                                />
                                <p className="text-[10px] text-text-tertiary text-right tabular-nums">
                                    {mask.brushSize}px
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => mask.setEraserActive(!mask.eraserActive)}
                                    className={`flex-1 px-2 py-1.5 rounded-[var(--radius-sm)] border text-[11px] font-medium transition-colors ${
                                        mask.eraserActive
                                            ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                                            : "border-border-primary text-text-secondary hover:bg-bg-tertiary"
                                    }`}
                                >
                                    {mask.eraserActive ? "Ластик" : "Кисть"}
                                </button>
                                <button
                                    type="button"
                                    onClick={mask.undo}
                                    disabled={!mask.hasMask}
                                    className="flex-1 px-2 py-1.5 rounded-[var(--radius-sm)] border border-border-primary text-[11px] font-medium text-text-secondary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Отмена
                                </button>
                                <button
                                    type="button"
                                    onClick={mask.clear}
                                    disabled={!mask.hasMask}
                                    className="flex-1 px-2 py-1.5 rounded-[var(--radius-sm)] border border-border-primary text-[11px] font-medium text-text-secondary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Очистить
                                </button>
                            </div>

                            {errorMsg && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-[var(--radius-sm)] p-2.5">
                                    <p className="text-[11px] text-red-500 leading-relaxed font-medium">{errorMsg}</p>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-border-primary">
                            <button
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={!mask.hasMask || isProcessing}
                                className="w-full px-4 py-2 rounded-[var(--radius-md)] bg-accent-primary text-white text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                            >
                                {isProcessing ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : (
                                    <Brush size={16} />
                                )}
                                Сохранить маску
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
