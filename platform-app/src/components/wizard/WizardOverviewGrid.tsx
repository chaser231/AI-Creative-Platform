"use client";

import { useEffect, useRef, useState } from "react";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import type {
    ArtboardBackgroundImage,
    Layer,
    LayerImageFill,
    LayoutGrid,
    Paint,
    StrokeAlign,
    StrokeJoin,
} from "@/types";

export interface WizardOverviewTile {
    id: string;
    name: string;
    /** e.g. "1080 × 1080" */
    label: string;
    width: number;
    height: number;
    /** Already-built draft layers (parent calls `buildDraftPreviewLayers`). */
    layers: Layer[];
    layoutGrids?: LayoutGrid[];
    isMaster?: boolean;
}

export interface WizardOverviewGridProps {
    tiles: WizardOverviewTile[];
    activeId: string;
    appearance: "light" | "dark";
    gridsVisible?: boolean;
    /** Shared artboard background (artboardProps) applied to every tile. */
    artboard: {
        fill?: Paint;
        fillEnabled?: boolean;
        backgroundImage?: ArtboardBackgroundImage;
        cornerRadius?: number;
        stroke?: Paint;
        strokeMode?: "paint" | "image";
        strokeImage?: LayerImageFill;
        strokeWidth?: number;
        strokeAlign?: StrokeAlign;
        strokeJoin?: StrokeJoin;
    };
    /** Single click → highlight/select. */
    onSelect: (id: string) => void;
    /** Double click → open that format in single view. */
    onOpen: (id: string) => void;
}

const PREVIEW_HEIGHT = 200;
const PREVIEW_FALLBACK_WIDTH = 260;

type ArtboardShared = WizardOverviewGridProps["artboard"];

function OverviewTileCard({
    tile,
    active,
    appearance,
    gridsVisible,
    artboard,
    onSelect,
    onOpen,
}: {
    tile: WizardOverviewTile;
    active: boolean;
    appearance: "light" | "dark";
    gridsVisible: boolean;
    artboard: ArtboardShared;
    onSelect: (id: string) => void;
    onOpen: (id: string) => void;
}) {
    const previewRef = useRef<HTMLDivElement | null>(null);
    const [previewWidth, setPreviewWidth] = useState<number>(PREVIEW_FALLBACK_WIDTH);

    useEffect(() => {
        const node = previewRef.current;
        if (!node) return;
        const update = () => {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0) {
                setPreviewWidth(Math.round(rect.width));
            }
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(tile.id)}
            onDoubleClick={() => onOpen(tile.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(tile.id);
                }
            }}
            title={`${tile.name} · ${tile.label}`}
            className={`group flex flex-col gap-2 rounded-[var(--radius-xl)] border bg-bg-surface p-3 text-left shadow-[var(--shadow-sm)] transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 ${
                active
                    ? "border-accent-lime-hover ring-2 ring-accent-lime/40"
                    : "border-border-primary hover:border-border-secondary"
            }`}
        >
            <div
                ref={previewRef}
                className="relative w-full overflow-hidden rounded-[var(--radius-lg)] border border-border-primary bg-bg-canvas"
                style={{ height: PREVIEW_HEIGHT }}
            >
                <PreviewCanvas
                    layers={tile.layers}
                    artboardWidth={tile.width}
                    artboardHeight={tile.height}
                    containerWidth={previewWidth}
                    containerHeight={PREVIEW_HEIGHT}
                    zoom={1}
                    appearance={appearance}
                    artboardFill={artboard.fill}
                    artboardFillEnabled={artboard.fillEnabled !== false}
                    artboardBackgroundImage={artboard.backgroundImage}
                    artboardCornerRadius={artboard.cornerRadius}
                    artboardStroke={artboard.stroke}
                    artboardStrokeMode={artboard.strokeMode}
                    artboardStrokeImage={artboard.strokeImage}
                    artboardStrokeWidth={artboard.strokeWidth}
                    artboardStrokeAlign={artboard.strokeAlign}
                    artboardStrokeJoin={artboard.strokeJoin}
                    layoutGrids={tile.layoutGrids}
                    showLayoutGrids={gridsVisible}
                />
                {tile.isMaster && (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-accent-lime px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-lime-text shadow-[var(--shadow-sm)]">
                        Мастер
                    </span>
                )}
            </div>
            <div className="flex min-w-0 items-baseline justify-between gap-2 px-1">
                <span
                    className="min-w-0 truncate text-sm font-medium text-text-primary"
                    title={tile.name}
                >
                    {tile.name}
                </span>
                <span
                    className="shrink-0 text-xs text-text-secondary"
                    title={tile.label}
                >
                    {tile.label}
                </span>
            </div>
        </button>
    );
}

export function WizardOverviewGrid({
    tiles,
    activeId,
    appearance,
    gridsVisible = false,
    artboard,
    onSelect,
    onOpen,
}: WizardOverviewGridProps) {
    if (tiles.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center p-6">
                <p className="text-sm text-text-tertiary">Нет форматов для обзора</p>
            </div>
        );
    }

    return (
        <div
            className="h-full w-full overflow-auto"
            role="listbox"
            aria-label="Сетка предпросмотра форматов"
        >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-6">
                {tiles.map((tile) => (
                    <OverviewTileCard
                        key={tile.id}
                        tile={tile}
                        active={tile.id === activeId}
                        appearance={appearance}
                        gridsVisible={gridsVisible}
                        artboard={artboard}
                        onSelect={onSelect}
                        onOpen={onOpen}
                    />
                ))}
            </div>
        </div>
    );
}

export default WizardOverviewGrid;
