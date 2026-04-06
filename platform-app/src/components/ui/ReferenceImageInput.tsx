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

import { useRef, useState, useCallback } from "react";
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
}

/** Get the @ref tag for a given index (0-based → @ref1, @ref2, ...) */
export function getRefTag(index: number): string {
    return `@ref${index + 1}`;
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
        } catch (err) {
            console.warn("ReferenceImageInput: compression failed", err);
        } finally {
            setIsProcessing(false);
        }
    }, [images, max, onChange]);

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
        <div className="flex items-center gap-1.5 flex-wrap">
            {/* Previews */}
            {images.map((src, idx) => (
                <div
                    key={idx}
                    className="relative flex-shrink-0 group"
                >
                    <div className="w-8 h-8 rounded-lg overflow-hidden border border-border-primary">
                        <img src={src} alt={`ref-${idx}`} className="w-full h-full object-cover" />
                        <button
                            onClick={() => removeImage(idx)}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
                            title="Удалить"
                        >
                            <X size={12} className="text-white" />
                        </button>
                    </div>
                    {/* @refN label — clickable to insert into prompt */}
                    {showLabels && (
                        <button
                            type="button"
                            onClick={() => onTagClick?.(getRefTag(idx))}
                            title={`Вставить ${getRefTag(idx)} в промпт`}
                            className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-mono font-bold bg-accent-primary text-text-inverse px-1 rounded-sm whitespace-nowrap leading-tight cursor-pointer hover:bg-accent-primary/80 transition-colors"
                        >
                            {getRefTag(idx)}
                        </button>
                    )}
                </div>
            ))}

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
                        flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium
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
