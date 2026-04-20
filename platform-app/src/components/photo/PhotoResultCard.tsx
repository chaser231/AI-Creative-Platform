"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Pencil, Image as ImageIcon, Download, Copy, LayoutGrid, CheckCircle2, Loader2, Sparkles, Layers, Maximize2, Minimize2, X } from "lucide-react";
import { usePhotoStore } from "@/store/photoStore";
import { useCreateBannerFromAsset } from "@/hooks/useCreateBannerFromAsset";
import { TemplatePickerForAssetModal } from "@/components/photo/TemplatePickerForAssetModal";

interface PhotoResultCardProps {
    url: string;
    messageId: string;
    prompt?: string;
    model?: string;
    savedAssetId?: string;
    onVariations?: () => void;
}

export function PhotoResultCard({ url, messageId, prompt, model, savedAssetId, onVariations }: PhotoResultCardProps) {
    const setEditContext = usePhotoStore((s) => s.setEditContext);
    const pushReference = usePhotoStore((s) => s.pushReference);
    const [hovered, setHovered] = useState(false);
    const [bannerMenuOpen, setBannerMenuOpen] = useState(false);
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const bannerMenuRef = useRef<HTMLDivElement>(null);

    const { createAndOpen, isCreating } = useCreateBannerFromAsset();

    // Close banner menu on outside click
    useEffect(() => {
        if (!bannerMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (bannerMenuRef.current && !bannerMenuRef.current.contains(e.target as Node)) {
                setBannerMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [bannerMenuOpen]);

    // Escape key closes the maximized preview and locks body scroll
    useEffect(() => {
        if (!maximized) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMaximized(false);
        };
        window.addEventListener("keydown", onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [maximized]);

    const handleEdit = () => {
        setEditContext({ url, sourceMessageId: messageId, assetId: savedAssetId });
    };

    const handleUseAsReference = () => {
        pushReference(url);
    };

    const handleDownload = async () => {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `photo-${messageId}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(url, "_blank");
        }
    };

    const handleCreateEmptyBanner = async () => {
        try {
            await createAndOpen({
                assetId: savedAssetId,
                imageUrl: savedAssetId ? undefined : url,
            });
        } catch (e) {
            console.error("Не удалось создать баннер из ассета:", e);
        } finally {
            setBannerMenuOpen(false);
        }
    };

    const handlePickTemplate = () => {
        // Close the dropdown and open the two-step template+slot picker.
        // The project is only created after the user confirms a slot.
        setBannerMenuOpen(false);
        setTemplatePickerOpen(true);
    };

    return (
        <div
            className="relative inline-block rounded-[var(--radius-lg)] overflow-hidden border border-border-primary bg-bg-tertiary group max-w-full"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt={prompt ?? "generated"}
                className="block max-w-full max-h-[420px] object-contain cursor-zoom-in"
                draggable={false}
                onClick={() => setMaximized(true)}
            />

            {savedAssetId && (
                <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-medium backdrop-blur-sm border border-emerald-500/30">
                    <CheckCircle2 size={10} /> В библиотеке
                </div>
            )}

            {(hovered || bannerMenuOpen) && (
                <div
                    className="absolute inset-0 bg-black/40 flex flex-col justify-between p-2 transition-opacity cursor-zoom-in"
                    onClick={(e) => {
                        // Overlay covers the image fully, so clicks on the dark
                        // backdrop (not on any action button) should still zoom.
                        if (e.target === e.currentTarget) setMaximized(true);
                    }}
                >
                    <div
                        className="flex items-center gap-1 flex-wrap"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setMaximized(true);
                        }}
                    >
                        <ActionButton icon={<Pencil size={11} />} label="Редактировать" onClick={handleEdit} />
                        <ActionButton icon={<ImageIcon size={11} />} label="Как референс" onClick={handleUseAsReference} />
                        <ActionButton icon={<Maximize2 size={11} />} label="Увеличить" onClick={() => setMaximized(true)} />
                        {onVariations && (
                            <ActionButton icon={<Copy size={11} />} label="Варианты" onClick={onVariations} />
                        )}
                    </div>
                    <div
                        className="flex items-center justify-between gap-1"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setMaximized(true);
                        }}
                    >
                        <div
                            className="flex items-center gap-1"
                            onClick={(e) => {
                                if (e.target === e.currentTarget) setMaximized(true);
                            }}
                        >
                            <ActionButton icon={<Download size={11} />} label="Скачать" onClick={handleDownload} />

                            {/* "В баннер" with dropdown */}
                            <div ref={bannerMenuRef} className="relative">
                                <ActionButton
                                    icon={isCreating
                                        ? <Loader2 size={11} className="animate-spin" />
                                        : <LayoutGrid size={11} />}
                                    label="В баннер"
                                    onClick={() => setBannerMenuOpen((o) => !o)}
                                    disabled={isCreating}
                                />
                                {bannerMenuOpen && (
                                    <div className="absolute bottom-[calc(100%+4px)] left-0 w-52 bg-bg-surface border border-border-primary rounded-[var(--radius-md)] shadow-xl py-1 z-20">
                                        <MenuItem
                                            icon={<Sparkles size={12} />}
                                            label="Пустой баннер"
                                            hint="Картинка как новый слой"
                                            onClick={handleCreateEmptyBanner}
                                        />
                                        <MenuItem
                                            icon={<Layers size={12} />}
                                            label="Из шаблона"
                                            hint="Выбрать слой для замены"
                                            onClick={handlePickTemplate}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                        {model && (
                            <span className="text-[10px] text-white/80 bg-black/30 px-1.5 py-0.5 rounded-full">
                                {model}
                            </span>
                        )}
                    </div>
                </div>
            )}

            <TemplatePickerForAssetModal
                open={templatePickerOpen}
                onClose={() => setTemplatePickerOpen(false)}
                imageUrl={url}
                assetId={savedAssetId}
            />

            {maximized && typeof document !== "undefined" &&
                createPortal(
                    <MaximizedPreview
                        url={url}
                        alt={prompt ?? "generated"}
                        onClose={() => setMaximized(false)}
                        onDownload={handleDownload}
                    />,
                    document.body
                )}
        </div>
    );
}

function MaximizedPreview({
    url,
    alt,
    onClose,
    onDownload,
}: {
    url: string;
    alt: string;
    onClose: () => void;
    onDownload: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 sm:p-10 cursor-zoom-out"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            {/* Top-right controls — always visible */}
            <div
                className="absolute top-4 right-4 flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={onDownload}
                    title="Скачать"
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                    <Download size={16} />
                </button>
                <button
                    onClick={onClose}
                    title="Свернуть (Esc)"
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                    <Minimize2 size={16} />
                </button>
                <button
                    onClick={onClose}
                    title="Закрыть"
                    className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                    <X size={16} />
                </button>
            </div>

            {/* The image never grows beyond the viewport and keeps aspect ratio */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={url}
                alt={alt}
                className="max-w-full max-h-full object-contain rounded-[var(--radius-lg)] shadow-2xl cursor-default"
                draggable={false}
                onClick={(e) => e.stopPropagation()}
            />
        </div>
    );
}

function ActionButton({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] bg-white/90 hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed text-[10px] font-medium text-on-light transition-colors cursor-pointer"
        >
            {icon}
            {label}
        </button>
    );
}

function MenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary text-left cursor-pointer transition-colors"
        >
            <span className="text-text-tertiary">{icon}</span>
            <span className="flex-1 min-w-0">
                <span className="block text-[12px] text-text-primary font-medium truncate">{label}</span>
                {hint && <span className="block text-[10px] text-text-tertiary truncate">{hint}</span>}
            </span>
        </button>
    );
}
