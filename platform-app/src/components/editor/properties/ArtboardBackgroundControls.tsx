"use client";

import { useRef, useState, type ReactNode } from "react";
import { Blend, ImageIcon, Palette, Trash2, Upload } from "lucide-react";
import type { ArtboardBackgroundFit, BackgroundSwatchValue, Swatch } from "@/types";
import type { ArtboardProps } from "@/store/canvas/types";
import { Popover, PopoverButton } from "@/components/ui/Popover";
import { Select } from "@/components/ui/Select";

export interface ArtboardBackgroundControlsProps {
    artboardProps: ArtboardProps;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
    paletteBackgrounds: Swatch[];
    onApplyBackgroundSwatch?: (swatchId: string) => void;
    onCreateSwatchFromBackground?: () => void;
    onUploadFile?: (file: File) => void | Promise<void>;
    variant?: "toolbar" | "sidebar";
}

export function ArtboardBackgroundControls({
    artboardProps,
    onUpdate,
    paletteBackgrounds,
    onApplyBackgroundSwatch,
    onCreateSwatchFromBackground,
    onUploadFile,
    variant = "toolbar",
}: ArtboardBackgroundControlsProps) {
    const bgUploadRef = useRef<HTMLInputElement>(null);
    const [bgUploading, setBgUploading] = useState(false);
    const [bgPopoverOpen, setBgPopoverOpen] = useState(false);

    const bg = artboardProps.backgroundImage;
    const imageBackgrounds = paletteBackgrounds.filter((swatch) => {
        const value = swatch.value as string | BackgroundSwatchValue;
        return typeof value === "object" && value.kind === "image";
    });

    const handleBgFilePick = async (file: File) => {
        if (!onUploadFile) return;
        setBgUploading(true);
        try {
            await onUploadFile(file);
        } finally {
            setBgUploading(false);
        }
    };

    const uploadInput = (
        <input
            ref={bgUploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleBgFilePick(file);
                e.target.value = "";
            }}
        />
    );

    const selectedBackgroundSwatchId = bg?.swatchRef;

    const paletteImageButtons = imageBackgrounds.map((swatch) => {
        const value = swatch.value as Extract<BackgroundSwatchValue, { kind: "image" }>;
        const selected = selectedBackgroundSwatchId === swatch.id;
        return (
            <button
                key={swatch.id}
                type="button"
                onClick={() => {
                    onApplyBackgroundSwatch?.(swatch.id);
                    setBgPopoverOpen(false);
                }}
                title={swatch.name}
                aria-pressed={selected}
                className={`relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border cursor-pointer transition-colors ${
                    selected
                        ? "border-accent-primary ring-2 ring-accent-primary/40"
                        : "border-border-primary hover:border-accent-primary"
                }`}
            >
                <img
                    src={value.src}
                    alt={swatch.name}
                    className="absolute inset-0 h-full w-full object-cover"
                />
            </button>
        );
    });

    if (variant === "sidebar") {
        return (
            <SidebarLayout
                uploadInput={uploadInput}
                bg={bg}
                bgUploading={bgUploading}
                canUpload={!!onUploadFile}
                onUploadClick={() => bgUploadRef.current?.click()}
                imageBackgrounds={imageBackgrounds}
                paletteImageButtons={paletteImageButtons}
                onApplyBackgroundSwatch={onApplyBackgroundSwatch}
                onUpdate={onUpdate}
            />
        );
    }

    return (
        <>
            {uploadInput}
            {!bg && (
                <div className="relative shrink-0">
                    <PopoverButton
                        icon={<ImageIcon size={12} />}
                        label={bgUploading ? "Загрузка..." : "Фон"}
                        isActive={bgPopoverOpen}
                        onClick={() => setBgPopoverOpen(!bgPopoverOpen)}
                    />
                    <Popover isOpen={bgPopoverOpen} onClose={() => setBgPopoverOpen(false)}>
                        <div className="min-w-[200px] space-y-2">
                            <button
                                type="button"
                                disabled={!onUploadFile}
                                onClick={() => {
                                    bgUploadRef.current?.click();
                                    setBgPopoverOpen(false);
                                }}
                                className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-bg-tertiary cursor-pointer disabled:opacity-50"
                            >
                                <Upload size={12} />
                                Загрузить изображение
                            </button>
                            {imageBackgrounds.length > 0 && onApplyBackgroundSwatch && (
                                <>
                                    <PaletteDivider />
                                    <p className="px-1 text-[9px] uppercase tracking-wider text-text-tertiary">Из палитры</p>
                                    <div className="grid grid-cols-4 gap-1.5">{paletteImageButtons}</div>
                                </>
                            )}
                        </div>
                    </Popover>
                </div>
            )}
            {bg && (
                <ToolbarActiveBackground
                    bg={bg}
                    onUpdate={onUpdate}
                    onCreateSwatch={onCreateSwatchFromBackground}
                />
            )}
        </>
    );
}

function PaletteDivider() {
    return <div className="h-px bg-border-primary" />;
}

function SidebarLayout({
    uploadInput,
    bg,
    bgUploading,
    canUpload,
    onUploadClick,
    imageBackgrounds,
    paletteImageButtons,
    onApplyBackgroundSwatch,
    onUpdate,
}: {
    uploadInput: ReactNode;
    bg: ArtboardProps["backgroundImage"];
    bgUploading: boolean;
    canUpload: boolean;
    onUploadClick: () => void;
    imageBackgrounds: Swatch[];
    paletteImageButtons: ReactNode;
    onApplyBackgroundSwatch?: (swatchId: string) => void;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
}) {
    return (
        <div className="space-y-2">
            {uploadInput}
            {!bg ? (
                <>
                    <button
                        type="button"
                        disabled={bgUploading || !canUpload}
                        onClick={onUploadClick}
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-xs font-medium text-text-primary transition-colors hover:bg-bg-tertiary cursor-pointer disabled:opacity-50"
                    >
                        <Upload size={13} className="text-text-secondary" />
                        {bgUploading ? "Загружаю..." : "Загрузить фото-фон"}
                    </button>
                    {imageBackgrounds.length > 0 && onApplyBackgroundSwatch && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-medium text-text-tertiary">Палитра фонов</p>
                            <div className="grid grid-cols-4 gap-1.5">{paletteImageButtons}</div>
                        </div>
                    )}
                </>
            ) : (
                <SidebarActiveBackground
                    bg={bg}
                    onUpdate={onUpdate}
                    imageBackgrounds={imageBackgrounds}
                    paletteImageButtons={paletteImageButtons}
                    onApplyBackgroundSwatch={onApplyBackgroundSwatch}
                />
            )}
        </div>
    );
}

function SidebarActiveBackground({
    bg,
    onUpdate,
    imageBackgrounds,
    paletteImageButtons,
    onApplyBackgroundSwatch,
}: {
    bg: NonNullable<ArtboardProps["backgroundImage"]>;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
    imageBackgrounds: Swatch[];
    paletteImageButtons: ReactNode;
    onApplyBackgroundSwatch?: (swatchId: string) => void;
}) {
    return (
        <div className="space-y-2">
            <div
                className="h-20 w-full rounded-[var(--radius-sm)] border border-border-primary bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.src})` }}
            />
            <BackgroundFitSelect bg={bg} onUpdate={onUpdate} />
            <BackgroundOpacitySlider bg={bg} onUpdate={onUpdate} wide />
            {imageBackgrounds.length > 0 && onApplyBackgroundSwatch && (
                <div className="space-y-1.5">
                    <p className="text-[10px] font-medium text-text-tertiary">Палитра фонов</p>
                    <div className="grid grid-cols-4 gap-1.5">{paletteImageButtons}</div>
                </div>
            )}
            <button
                type="button"
                onClick={() => onUpdate({ backgroundImage: undefined })}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
            >
                <Trash2 size={12} />
                Убрать фото-фон
            </button>
        </div>
    );
}

function ToolbarActiveBackground({
    bg,
    onUpdate,
    onCreateSwatch,
}: {
    bg: NonNullable<ArtboardProps["backgroundImage"]>;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
    onCreateSwatch?: () => void;
}) {
    return (
        <>
            <div
                className="h-6 w-6 shrink-0 rounded-[var(--radius-sm)] border border-border-primary bg-cover bg-center"
                style={{ backgroundImage: `url(${bg.src})` }}
            />
            <BackgroundFitSelect bg={bg} onUpdate={onUpdate} />
            <BackgroundOpacitySlider bg={bg} onUpdate={onUpdate} />
            {onCreateSwatch && (
                <button
                    type="button"
                    onClick={onCreateSwatch}
                    className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-border-primary px-2 py-1 text-[10px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                    title="Сохранить в палитру"
                >
                    <Palette size={10} />
                </button>
            )}
            <button
                type="button"
                onClick={() => onUpdate({ backgroundImage: undefined })}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border border-border-primary px-2 py-1 text-[10px] text-text-tertiary hover:bg-red-500/10 hover:text-red-500"
                title="Удалить фон"
            >
                <Trash2 size={10} />
            </button>
        </>
    );
}

function BackgroundFitSelect({
    bg,
    onUpdate,
}: {
    bg: NonNullable<ArtboardProps["backgroundImage"]>;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
}) {
    return (
        <Select
            size="sm"
            value={bg.fit}
            onChange={(val) => onUpdate({
                backgroundImage: { ...bg, fit: val as ArtboardBackgroundFit },
            })}
            options={[
                { value: "cover", label: "Cover" },
                { value: "contain", label: "Contain" },
                { value: "fill", label: "Fill" },
            ]}
        />
    );
}

function BackgroundOpacitySlider({
    bg,
    onUpdate,
    wide = false,
}: {
    bg: NonNullable<ArtboardProps["backgroundImage"]>;
    onUpdate: (updates: Partial<ArtboardProps>) => void;
    wide?: boolean;
}) {
    return (
        <div className={`flex items-center gap-2 ${wide ? "w-full" : "shrink-0"}`}>
            <Blend size={10} className="text-text-tertiary" />
            <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bg.opacity ?? 1}
                onChange={(e) => onUpdate({
                    backgroundImage: { ...bg, opacity: Number(e.target.value) },
                })}
                className={`cursor-pointer accent-accent-primary ${wide ? "w-full" : "w-16"}`}
                title={`Прозрачность: ${Math.round((bg.opacity ?? 1) * 100)}%`}
            />
        </div>
    );
}

