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
import { Image as ImageIcon, Link2, Loader2, Upload, X } from "lucide-react";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import {
    AssetPickerModal,
    type AssetPickerSelection,
} from "@/components/assets/AssetPickerModal";
import { compressImageFile, uploadForAI } from "@/utils/imageUpload";
import type { ImageInputParams } from "@/lib/workflow/nodeParamSchemas";

export interface ImageSourceInputProps {
    value: Partial<ImageInputParams>;
    onChange: (next: Partial<ImageInputParams>) => void;
    error?: string;
}

type Tab = NonNullable<ImageInputParams["source"]>;

export function ImageSourceInput({ value, onChange, error }: ImageSourceInputProps) {
    const { currentWorkspace } = useWorkspace();
    const workspaceId = currentWorkspace?.id ?? "";

    const [pickerOpen, setPickerOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [pickedFilename, setPickedFilename] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const tab: Tab = value.source ?? "asset";

    const setTab = useCallback(
        (next: Tab) => {
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
            setUploading(true);
            try {
                const base64 = await compressImageFile(file, 2000);
                const url = await uploadForAI(base64, "workflow-input");
                if (!url || url === base64) {
                    setUploadError("Не удалось загрузить файл");
                    return;
                }
                onChange({ source: "upload", sourceUrl: url, assetId: undefined });
                setPickedFilename(file.name);
            } catch (err) {
                setUploadError(err instanceof Error ? err.message : "Ошибка загрузки");
            } finally {
                setUploading(false);
            }
        },
        [onChange],
    );

    return (
        <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-text-primary">
                Источник изображения
            </span>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-md bg-bg-tertiary p-1">
                <TabButton active={tab === "asset"} onClick={() => setTab("asset")} icon={<ImageIcon size={12} />} label="Из библиотеки" />
                <TabButton active={tab === "url"} onClick={() => setTab("url")} icon={<Link2 size={12} />} label="По URL" />
                <TabButton active={tab === "upload"} onClick={() => setTab("upload")} icon={<Upload size={12} />} label="Загрузить" />
            </div>

            {/* Tab body */}
            {tab === "asset" && (
                <div className="flex flex-col gap-2">
                    {value.assetId && value.sourceUrl ? (
                        <PreviewBox
                            url={value.sourceUrl}
                            label={pickedFilename ?? value.assetId}
                            onClear={() => onChange({ source: "asset" })}
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            disabled={!workspaceId}
                            className="flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-border-secondary bg-bg-surface px-3 text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
                        >
                            <ImageIcon size={14} />
                            Выбрать из библиотеки
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
                <input
                    type="url"
                    value={value.sourceUrl ?? ""}
                    onChange={(e) => onChange({ source: "url", sourceUrl: e.target.value || undefined })}
                    placeholder="https://example.com/image.png"
                    className="h-9 w-full rounded-md border border-border-primary bg-bg-surface px-2.5 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/40"
                />
            )}

            {tab === "upload" && (
                <div className="flex flex-col gap-2">
                    {value.sourceUrl && !value.assetId ? (
                        <PreviewBox
                            url={value.sourceUrl}
                            label={pickedFilename ?? "Загруженный файл"}
                            onClear={() => onChange({ source: "upload" })}
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="flex h-9 items-center justify-center gap-2 rounded-md border border-dashed border-border-secondary bg-bg-surface px-3 text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
                        >
                            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            {uploading ? "Загрузка..." : "Выбрать файл"}
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
                        <span className="text-xs text-red-500">{uploadError}</span>
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

function TabButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs font-medium transition-colors ${
                active
                    ? "bg-bg-surface text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
            }`}
        >
            {icon}
            {label}
        </button>
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
        <div className="flex items-center gap-2 rounded-md border border-border-primary bg-bg-secondary p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt={label}
                className="h-12 w-12 flex-shrink-0 rounded object-cover"
            />
            <span className="flex-1 truncate text-xs text-text-primary">
                {label}
            </span>
            <button
                type="button"
                onClick={onClear}
                className="rounded p-1 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Очистить"
            >
                <X size={14} />
            </button>
        </div>
    );
}
