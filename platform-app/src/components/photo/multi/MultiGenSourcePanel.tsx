"use client";

import { useRef, useState } from "react";
import { Upload, FileArchive, HardDrive, Loader2 } from "lucide-react";
import {
    importFilesAsSources,
    importZipAsSources,
    importYandexDiskAsSources,
    type ImportedSource,
} from "@/utils/multiGenImport";

type SourceTab = "upload" | "zip" | "yadisk";

interface MultiGenSourcePanelProps {
    projectId: string;
    disabled?: boolean;
    onImported: (sources: ImportedSource[]) => void;
}

const TABS: { id: SourceTab; label: string; icon: typeof Upload }[] = [
    { id: "upload", label: "Загрузка", icon: Upload },
    { id: "zip", label: "ZIP-архив", icon: FileArchive },
    { id: "yadisk", label: "Яндекс.Диск", icon: HardDrive },
];

export function MultiGenSourcePanel({
    projectId,
    disabled,
    onImported,
}: MultiGenSourcePanelProps) {
    const [tab, setTab] = useState<SourceTab>("upload");
    const [importing, setImporting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [yadiskUrl, setYadiskUrl] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const zipInputRef = useRef<HTMLInputElement>(null);

    const runImport = async (fn: () => Promise<{ sources: ImportedSource[]; errors: string[] }>) => {
        setImporting(true);
        setErrors([]);
        try {
            const result = await fn();
            if (result.sources.length > 0) onImported(result.sources);
            setErrors(result.errors);
        } finally {
            setImporting(false);
        }
    };

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const list = Array.from(files);
        void runImport(() => importFilesAsSources(list, projectId));
    };

    const handleZip = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        void runImport(() => importZipAsSources(files[0], projectId));
    };

    const handleYadisk = () => {
        if (!yadiskUrl.trim()) return;
        void runImport(() => importYandexDiskAsSources(yadiskUrl, projectId));
    };

    const busy = disabled || importing;

    return (
        <div className="rounded-[var(--radius-lg)] border border-border-primary bg-bg-surface p-3">
            <div className="flex items-center gap-1 mb-3">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            disabled={busy}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                                active
                                    ? "bg-accent-lime/15 text-accent-primary"
                                    : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                            }`}
                        >
                            <Icon size={13} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === "upload" && (
                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (!busy) setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        if (!busy) handleFiles(e.dataTransfer.files);
                    }}
                    className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-8 text-center transition-colors ${
                        dragOver
                            ? "border-accent-lime-hover bg-accent-lime/10"
                            : "border-border-primary"
                    }`}
                >
                    <Upload size={22} className="text-text-tertiary" />
                    <p className="text-[12px] text-text-secondary">
                        Перетащите изображения сюда или
                    </p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-60"
                    >
                        Выбрать файлы
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                            handleFiles(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>
            )}

            {tab === "zip" && (
                <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed border-border-primary px-4 py-8 text-center">
                    <FileArchive size={22} className="text-text-tertiary" />
                    <p className="text-[12px] text-text-secondary">
                        Загрузите ZIP-архив с изображениями
                    </p>
                    <button
                        onClick={() => zipInputRef.current?.click()}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-[var(--radius-md)] text-[12px] font-medium bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-60"
                    >
                        Выбрать архив
                    </button>
                    <input
                        ref={zipInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        hidden
                        onChange={(e) => {
                            handleZip(e.target.files);
                            e.target.value = "";
                        }}
                    />
                </div>
            )}

            {tab === "yadisk" && (
                <div className="flex flex-col gap-2 px-1 py-2">
                    <p className="text-[12px] text-text-secondary">
                        Вставьте публичную ссылку на папку или файл Яндекс.Диска
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            value={yadiskUrl}
                            onChange={(e) => setYadiskUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleYadisk();
                            }}
                            placeholder="https://disk.yandex.ru/d/..."
                            disabled={busy}
                            className="flex-1 min-w-0 bg-bg-tertiary text-[12px] text-text-primary px-3 py-2 rounded-[var(--radius-md)] border border-border-primary focus:border-border-focus outline-none disabled:opacity-60"
                        />
                        <button
                            onClick={handleYadisk}
                            disabled={busy || !yadiskUrl.trim()}
                            className="px-3 py-2 rounded-[var(--radius-md)] text-[12px] font-medium bg-accent-lime-hover text-accent-lime-text hover:bg-accent-lime transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Импортировать
                        </button>
                    </div>
                </div>
            )}

            {importing && (
                <div className="flex items-center gap-2 mt-3 text-[12px] text-text-secondary">
                    <Loader2 size={13} className="animate-spin" /> Загрузка
                    источников…
                </div>
            )}

            {errors.length > 0 && (
                <ul className="mt-3 space-y-0.5">
                    {errors.map((err, i) => (
                        <li key={i} className="text-[11px] text-amber-500">
                            {err}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
