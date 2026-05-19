"use client";

/**
 * ReferenceImageInput
 *
 * Reusable component for attaching reference photos to AI prompts.
 * Supports click-to-upload, drag & drop, preview thumbnails, and
 * automatic JPEG compression to keep payloads small.
 *
 * Each image gets a label (@ref1, @ref2, ...) that users can type
 * in their prompt to reference specific images.
 *
 * Only shown when the selected AI model has the "vision" capability.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ImagePlus, X } from "lucide-react";

export interface ReferenceImageInputProps {
    images: string[];
    onChange: (images: string[]) => void;
    /** Maximum number of images allowed (default: 3) */
    max?: number;
    disabled?: boolean;
    /** Label shown on the upload trigger (default: "Референс") */
    label?: string;
    /** Show @refN labels on thumbnails (default: true) */
    showLabels?: boolean;
    /** Called when user clicks an @refN badge — use to insert into prompt */
    onTagClick?: (tag: string) => void;
    /** Hide inline previews when a prompt bar renders them in its own tray. */
    previewMode?: "inline" | "none";
    /**
     * Optional side-channel: the raw File objects the user dropped, fired
     * once per drop/pick. Prompt bars use this to mirror the reference into
     * the project's asset library so the user can reuse it later. Firing is
     * fire-and-forget; errors must not block compression/preview.
     */
    onFilesAdded?: (files: File[]) => void;
}

/** Get the @ref tag for a given index (0-based → @ref1, @ref2, ...) */
export function getRefTag(index: number): string {
    return `@ref${index + 1}`;
}

/** Horizontal padding to reserve in the prompt area so text does not sit under the tray. */
export function getReferenceTrayReserveWidth(imageCount: number, maxVisible = 4): number {
    if (imageCount <= 0) return 0;
    const visible = Math.min(imageCount, maxVisible);
    const hasOverflow = imageCount > maxVisible;
    // ~36px per thumb + gaps + optional +N button + tray padding
    return 12 + visible * 36 + (hasOverflow ? 40 : 0) + 16;
}

/** Compress an image File to JPEG base64, max 1024px on longest side */
async function compressImage(file: File): Promise<string> {
    const MAX = 1024;
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);

            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("Canvas not supported"));
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = reject;
        img.src = objectUrl;
    });
}

export function ReferenceImageInput({
    images,
    onChange,
    max = 3,
    disabled = false,
    label = "Референс",
    showLabels = true,
    onTagClick,
    previewMode = "inline",
    onFilesAdded,
}: ReferenceImageInputProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const canAdd = images.length < max && !disabled;

    const processFiles = useCallback(async (files: FileList | File[]) => {
        const arr = Array.from(files).filter(f => f.type.startsWith("image/"));
        const remaining = max - images.length;
        const toProcess = arr.slice(0, remaining);
        if (toProcess.length === 0) return;

        setIsProcessing(true);
        try {
            const compressed = await Promise.all(toProcess.map(compressImage));
            onChange([...images, ...compressed]);
            // Fire the file side-channel AFTER previews land — prompt bars
            // handle this asynchronously and we want the UI to update first.
            try {
                onFilesAdded?.(toProcess);
            } catch (err) {
                console.warn("ReferenceImageInput: onFilesAdded threw", err);
            }
        } catch (err) {
            console.warn("ReferenceImageInput: compression failed", err);
        } finally {
            setIsProcessing(false);
        }
    }, [images, max, onChange, onFilesAdded]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) processFiles(e.target.files);
        e.target.value = ""; // allow re-selecting same file
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (canAdd && e.dataTransfer.files) processFiles(e.dataTransfer.files);
    }, [canAdd, processFiles]);

    const removeImage = (idx: number) => {
        onChange(images.filter((_, i) => i !== idx));
    };

    if (disabled) return null;

    return (
        <div className="flex items-center gap-1.5">
            {/* Previews */}
            {previewMode === "inline" && (
                <ReferenceImagePreviewTray
                    images={images}
                    onChange={onChange}
                    showLabels={showLabels}
                    onTagClick={onTagClick}
                    maxVisible={4}
                />
            )}

            {/* Upload trigger */}
            {canAdd && (
                <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    title={`Добавить референс (${images.length}/${max})`}
                    className={`
                        flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] font-medium
                        border transition-all cursor-pointer select-none flex-shrink-0
                        ${isDragging
                            ? "border-accent-primary/60 bg-accent-primary/10 text-accent-primary"
                            : "border-border-primary/50 text-text-tertiary hover:text-text-secondary hover:border-border-primary hover:bg-bg-secondary/50"
                        }
                        ${isProcessing ? "opacity-50 cursor-wait" : ""}
                    `}
                >
                    <ImagePlus size={13} />
                    {images.length === 0 && (
                        <span>{label}</span>
                    )}
                    {images.length > 0 && (
                        <span className="tabular-nums">{images.length}/{max}</span>
                    )}
                </button>
            )}

            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple={max > 1}
                className="hidden"
                onChange={handleFileChange}
            />
        </div>
    );
}

interface ReferenceImagePreviewTrayProps {
    images: string[];
    onChange: (images: string[]) => void;
    showLabels?: boolean;
    onTagClick?: (tag: string) => void;
    maxVisible?: number;
    className?: string;
    /** Overflow grid opens above the tray by default (prompt bars sit at the bottom). */
    popoverPlacement?: "above" | "below";
}

export function ReferenceImagePreviewTray({
    images,
    onChange,
    showLabels = true,
    onTagClick,
    maxVisible = 4,
    className = "",
    popoverPlacement = "above",
}: ReferenceImagePreviewTrayProps) {
    const [open, setOpen] = useState(false);
    const trayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!trayRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    if (images.length === 0) return null;

    const visibleImages = images.slice(0, maxVisible);
    const hiddenCount = Math.max(0, images.length - visibleImages.length);
    const removeImage = (idx: number) => {
        onChange(images.filter((_, imageIndex) => imageIndex !== idx));
    };

    return (
        <div
            ref={trayRef}
            className={`relative flex items-center gap-1.5 rounded-[14px] border border-border-primary/70 bg-bg-surface/95 p-1.5 shadow-[var(--shadow-md)] backdrop-blur-xl ${className}`}
        >
            {visibleImages.map((src, idx) => (
                <ReferenceThumbnail
                    key={`${idx}-${src.slice(0, 32)}`}
                    src={src}
                    index={idx}
                    showLabel={showLabels}
                    onRemove={() => removeImage(idx)}
                    onTagClick={onTagClick}
                />
            ))}

            {hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    aria-label={`Показать все референсы, скрыто ${hiddenCount}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-primary/70 bg-bg-primary text-[11px] font-semibold text-text-secondary transition-colors hover:border-border-secondary hover:bg-bg-tertiary cursor-pointer"
                    title={`Показать ещё ${hiddenCount} референсов`}
                >
                    +{hiddenCount}
                </button>
            )}

            {open && hiddenCount > 0 && (
                <div className={`absolute right-0 z-20 grid w-[188px] grid-cols-4 gap-1.5 rounded-[14px] border border-border-primary bg-bg-surface p-2 shadow-xl ${
                        popoverPlacement === "below" ? "top-full mt-2" : "bottom-full mb-2"
                    }`}>
                    {images.map((src, idx) => (
                        <ReferenceThumbnail
                            key={`all-${idx}-${src.slice(0, 32)}`}
                            src={src}
                            index={idx}
                            showLabel={showLabels}
                            onRemove={() => removeImage(idx)}
                            onTagClick={onTagClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function ReferenceThumbnail({
    src,
    index,
    showLabel,
    onRemove,
    onTagClick,
}: {
    src: string;
    index: number;
    showLabel: boolean;
    onRemove: () => void;
    onTagClick?: (tag: string) => void;
}) {
    const tag = getRefTag(index);

    return (
        <div className="group relative flex-shrink-0">
            <div className="relative h-8 w-8 overflow-hidden rounded-lg border border-border-primary bg-bg-tertiary">
                <img src={src} alt={`ref-${index + 1}`} className="h-full w-full object-cover" />
                <button
                    type="button"
                    onClick={onRemove}
                    className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                    title="Удалить"
                >
                    <X size={12} className="text-white" />
                </button>
            </div>
            {showLabel && (
                <button
                    type="button"
                    onClick={() => onTagClick?.(tag)}
                    title={`Вставить ${tag} в промпт`}
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-accent-primary px-1 font-mono text-[8px] font-bold leading-tight text-text-inverse transition-colors hover:bg-accent-primary/80 cursor-pointer"
                >
                    {tag}
                </button>
            )}
        </div>
    );
}
