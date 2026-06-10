"use client";

import { useState } from "react";
import { Download, ImagePlus, Loader2, Check } from "lucide-react";
import { useVideoStore } from "@/store/videoStore";
import { getVideoModelById } from "@/lib/video-models";
import { getMotionPresetById } from "@/lib/video-presets";
import { captureVideoFrame } from "@/utils/videoFrame";
import { uploadImageToS3 } from "@/utils/imageUpload";

interface VideoResultCardProps {
    url: string;
    projectId: string;
    model?: string;
    metadata?: {
        mode?: string;
        duration?: string;
        aspectRatio?: string;
        resolution?: string;
        presetId?: string;
    };
}

export function VideoResultCard({ url, projectId, model, metadata }: VideoResultCardProps) {
    const setStartFrameUrl = useVideoStore((s) => s.setStartFrameUrl);
    const setMode = useVideoStore((s) => s.setMode);
    const [extracting, setExtracting] = useState(false);
    const [extracted, setExtracted] = useState(false);
    const [extractError, setExtractError] = useState<string | null>(null);

    const modelEntry = model ? getVideoModelById(model) : undefined;
    const preset = metadata?.presetId ? getMotionPresetById(metadata.presetId) : undefined;

    const handleUseFrameAsStart = async () => {
        setExtractError(null);
        setExtracting(true);
        try {
            const frame = await captureVideoFrame(url, 0);
            const uploaded = await uploadImageToS3(frame, projectId, "image/webp");
            if (!uploaded) throw new Error("Не удалось загрузить кадр");
            setMode("i2v");
            setStartFrameUrl(uploaded);
            setExtracted(true);
            setTimeout(() => setExtracted(false), 2000);
        } catch (err) {
            setExtractError(err instanceof Error ? err.message : "Не удалось извлечь кадр");
        } finally {
            setExtracting(false);
        }
    };

    return (
        <div className="max-w-[480px] w-full rounded-[var(--radius-xl)] border border-border-primary bg-bg-tertiary/40 overflow-hidden">
            <video
                src={url}
                controls
                preload="metadata"
                playsInline
                className="w-full max-h-[420px] bg-black"
            />
            <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2 text-[10.5px] text-text-tertiary">
                    {modelEntry && <span className="font-medium text-text-secondary">{modelEntry.label}</span>}
                    {metadata?.duration && <span>{metadata.duration.replace(/s$/i, "")}с</span>}
                    {metadata?.resolution && <span>{metadata.resolution}</span>}
                    {preset && <span title={preset.description}>{preset.glyph} {preset.label}</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={handleUseFrameAsStart}
                        disabled={extracting}
                        title="Использовать кадр как старт следующей генерации"
                        className="p-1.5 rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {extracting ? <Loader2 size={13} className="animate-spin" /> : extracted ? <Check size={13} className="text-emerald-500" /> : <ImagePlus size={13} />}
                    </button>
                    <a
                        href={url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        title="Скачать видео"
                        className="p-1.5 rounded-[var(--radius-sm)] text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                    >
                        <Download size={13} />
                    </a>
                </div>
            </div>
            {extractError && <p className="px-3 pb-2 text-[10px] text-red-400">{extractError}</p>}
        </div>
    );
}
