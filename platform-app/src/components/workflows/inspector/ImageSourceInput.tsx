"use client";

/**
 * Composite input for ImageInput node parameters.
 *
 * Three sources: pick from library (assetId), paste URL, upload file.
 * "Upload" stages the file via uploadForAI (presigned-PUT to S3) and stores
 * the resulting public URL in `sourceUrl` — no Asset row is created in this
 * phase, the workflow executor (Phase 4) is the right place to register an
 * Asset for permanence.
 *
 * Phase 3, Wave 4 — D-15 in 03-CONTEXT.md.
 */

import { useCallback, useRef, useState } from "react";
import {
    AlertCircle,
    Image as ImageIcon,
    Link2,
    Loader2,
    RotateCcw,
    Upload,
    X,
} from "lucide-react";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import {
    AssetPickerModal,
    type AssetPickerSelection,
} from "@/components/assets/AssetPickerModal";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import { compressImageFile, uploadForAI } from "@/utils/imageUpload";
import type { ImageInputParams } from "@/lib/workflow/nodeParamSchemas";

export interface ImageSourceInputProps {
    value: Partial<ImageInputParams>;
    onChange: (next: Partial<ImageInputParams>) => void;
    error?: string;
}

type Tab = NonNullable<ImageInputParams["source"]>;

export const MAX_WORKFLOW_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

const SOURCE_OPTIONS: SegmentOption<Tab>[] = [
    { value: "asset", label: "Библиотека", icon: <ImageIcon size={12} /> },
    { value: "url", label: "URL", icon: <Link2 size={12} /> },
    { value: "upload", label: "Файл", icon: <Upload size={12} /> },
];

export function validateWorkflowImageFile(file: File): string | null {
    if (!file.type.startsWith("image/")) {
        return "Выберите файл изображения";
    }
    if (file.size > MAX_WORKFLOW_IMAGE_UPLOAD_BYTES) {
        return "Файл больше 20 МБ";
    }
    return null;
}

export function ImageSourceInput({ value, onChange, error }: ImageSourceInputProps) {
    const { currentWorkspace } = useWorkspace();
    const workspaceId = currentWorkspace?.id ?? "";

    const [pickerOpen, setPickerOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [canRetryUpload, setCanRetryUpload] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [pickedFilename, setPickedFilename] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const lastFileRef = useRef<File | null>(null);

    const tab: Tab = value.source ?? "asset";

    const setTab = useCallback(
        (next: Tab) => {
            setUploadError(null);
            setDragActive(false);
            setCanRetryUpload(false);
            // Switching tabs clears the now-irrelevant fields so the validator
            // doesn't get tripped up by stale data from the previous mode.
            if (next === "asset") {
                onChange({ source: "asset", assetId: value.assetId, sourceUrl: undefined });
            } else if (next === "url") {
                onChange({ source: "url", sourceUrl: value.sourceUrl, assetId: undefined });
            } else {
                onChange({ source: "upload", sourceUrl: value.sourceUrl, assetId: undefined });
            }
        },
        [onChange, value.assetId, value.sourceUrl],
    );

    const handlePickFromLibrary = useCallback(
        (assetId: string, picked: AssetPickerSelection) => {
            setPickedFilename(picked.filename);
            // Library picks store both the assetId (canonical) and the url
            // so the node preview can render without an extra trpc round-trip.
            onChange({ source: "asset", assetId, sourceUrl: picked.url });
        },
        [onChange],
    );

    const handleFile = useCallback(
        async (file: File) => {
            setUploadError(null);
            lastFileRef.current = file;
            setCanRetryUpload(true);
            const validationError = validateWorkflowImageFile(file);
            if (validationError) {
                setUploadError(validationError);
                return;
            }

            setUploading(true);
            try {
                const base64 = await compressImageFile(file, 2000);
                const url = await uploadForAI(base64, "tmp");
                if (!url || url === base64) {
                    setUploadError("Не удалось загрузить файл");
                    return;
                }
                onChange({ source: "upload", sourceUrl: url, assetId: undefined });
                setPickedFilename(file.name);
                lastFileRef.current = null;
                setCanRetryUpload(false);
            } catch (err) {
                setUploadError(err instanceof Error ? err.message : "Ошибка загрузки");
            } finally {
                setUploading(false);
                setDragActive(false);
            }
        },
        [onChange],
    );

    const handleDrop = useCallback(
        (event: React.DragEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
        },
        [handleFile],
    );

    const retryUpload = useCallback(() => {
        const file = lastFileRef.current;
        if (file) void handleFile(file);
    }, [handleFile]);

    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text-primary">
                Источник изображения
            </span>

            <SegmentedControl
                value={tab}
                onChange={setTab}
                options={SOURCE_OPTIONS}
                size="sm"
                fullWidth
                className="w-full [&>button]:flex-1"
            />

            {/* Tab body */}
            {tab === "asset" && (
                <div className="flex flex-col gap-2">
                    {value.assetId && value.sourceUrl ? (
                        <PreviewBox
                            url={value.sourceUrl}
                            label={pickedFilename ?? value.assetId}
                            onClear={() => {
                                setPickedFilename(null);
                                onChange({
                                    source: "asset",
                                    assetId: undefined,
                                    sourceUrl: undefined,
                                });
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            disabled={!workspaceId}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border-secondary bg-bg-surface px-3 text-xs text-text-secondary transition hover:bg-bg-tertiary disabled:opacity-50"
                        >
                            <ImageIcon size={14} />
                            {workspaceId ? "Выбрать из библиотеки" : "Нет активного воркспейса"}
                        </button>
                    )}
                    <AssetPickerModal
                        open={pickerOpen}
                        onClose={() => setPickerOpen(false)}
                        onSelect={handlePickFromLibrary}
                        workspaceId={workspaceId}
                    />
                </div>
            )}

            {tab === "url" && (
                <div className="flex flex-col gap-2">
                    <input
                        type="url"
                        value={value.sourceUrl ?? ""}
                        onChange={(e) => onChange({ source: "url", sourceUrl: e.target.value || undefined })}
                        placeholder="https://example.com/image.png"
                        className="h-9 w-full rounded-[var(--radius-md)] border border-border-primary bg-bg-surface px-2.5 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/40"
                    />
                    {value.sourceUrl && (
                        <PreviewBox
                            url={value.sourceUrl}
                            label="Изображение по URL"
                            onClear={() => onChange({ source: "url", sourceUrl: undefined })}
                        />
                    )}
                </div>
            )}

            {tab === "upload" && (
                <div className="flex flex-col gap-2">
                    {value.sourceUrl && !value.assetId ? (
                        <div className="flex flex-col gap-2">
                            <PreviewBox
                                url={value.sourceUrl}
                                label={pickedFilename ?? "Загруженный файл"}
                                onClear={() => {
                                    setUploadError(null);
                                    setCanRetryUpload(false);
                                    setPickedFilename(null);
                                    lastFileRef.current = null;
                                    onChange({
                                        source: "upload",
                                        sourceUrl: undefined,
                                        assetId: undefined,
                                    });
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="flex h-8 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-surface px-3 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
                            >
                                <Upload size={13} />
                                Заменить файл
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            onDragEnter={(event) => {
                                event.preventDefault();
                                setDragActive(true);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "copy";
                                setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={handleDrop}
                            className={[
                                "flex min-h-24 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed px-3 py-4 text-center text-xs transition disabled:opacity-50",
                                dragActive
                                    ? "border-border-focus bg-accent-lime/10 text-text-primary"
                                    : "border-border-secondary bg-bg-surface text-text-secondary hover:bg-bg-tertiary",
                            ].join(" ")}
                        >
                            {uploading ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Upload size={16} />
                            )}
                            <span className="font-medium">
                                {uploading ? "Загрузка..." : "Перетащите изображение сюда"}
                            </span>
                            {!uploading && (
                                <span className="text-[11px] text-text-tertiary">
                                    или выберите файл до 20 МБ
                                </span>
                            )}
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleFile(f);
                            e.target.value = "";
                        }}
                    />
                    {uploadError && (
                        <div
                            className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-500"
                            role="alert"
                        >
                            <span className="flex min-w-0 items-center gap-1.5">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{uploadError}</span>
                            </span>
                            {canRetryUpload && (
                                <button
                                    type="button"
                                    onClick={retryUpload}
                                    disabled={uploading}
                                    className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] font-medium hover:bg-red-500/10 disabled:opacity-50"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                    Повторить
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {error && (
                <span className="text-xs text-red-500" role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}

function PreviewBox({
    url,
    label,
    onClear,
}: {
    url: string;
    label: string;
    onClear: () => void;
}) {
    return (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt={label}
                className="h-12 w-12 flex-shrink-0 rounded-[var(--radius-sm)] object-cover"
            />
            <span className="flex-1 truncate text-xs text-text-primary">
                {label}
            </span>
            <button
                type="button"
                onClick={onClear}
                className="rounded-[var(--radius-sm)] p-1 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Очистить"
            >
                <X size={14} />
            </button>
        </div>
    );
}
