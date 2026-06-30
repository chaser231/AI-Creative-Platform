"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Layers } from "lucide-react";
import Konva from "konva";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { PreviewCanvas } from "@/components/editor/PreviewCanvas";
import {
    buildDraftPreviewLayers,
    getEditableLayerEntries,
    getPreviewFormatSources,
    type WizardImageViewOverride,
    type WizardLayerStyleOverride,
} from "@/components/wizard/WizardContentWorkspace";
import { projectExpansionToResize, type LayerExpansionOverride } from "@/utils/wizardExpand";
import { downloadDataUrl, sanitizeExportFileName, zipPngDataUrls } from "@/utils/exportImage";
import { withEditorChromeHidden } from "@/utils/stageExportCapture";
import type { TemplatePackV2 } from "@/services/templateService";
import type { ArtboardProps } from "@/store/canvas/types";
import { DEFAULT_ARTBOARD_PROPS } from "@/store/canvas/types";
import { resolvePreviewFormatArtboard } from "@/store/canvas/artboardProps";

type WizardExportMode = "single" | "batch";

interface WizardExportModalProps {
    open: boolean;
    onClose: () => void;
    selectedTemplate: TemplatePackV2;
    activeFormatId: string;
    formatArtboardProps: Record<string, ArtboardProps>;
    textValues: Record<string, string>;
    imageValues: Record<string, string>;
    imageViewOverrides: Record<string, WizardImageViewOverride>;
    layerStyleOverrides: Record<string, WizardLayerStyleOverride>;
    layerGeometryOverrides: Record<string, LayerExpansionOverride>;
}

export function WizardExportModal({
    open,
    onClose,
    selectedTemplate,
    activeFormatId,
    formatArtboardProps,
    textValues,
    imageValues,
    imageViewOverrides,
    layerStyleOverrides,
    layerGeometryOverrides,
}: WizardExportModalProps) {
    const stageRef = useRef<Konva.Stage | null>(null);
    const readyRef = useRef(false);
    const imageLoadStateRef = useRef({ pending: 0, failed: 0 });
    const previewFormats = useMemo(() => getPreviewFormatSources(selectedTemplate), [selectedTemplate]);
    const exportableFormats = useMemo(
        () => previewFormats.filter((format) => !format.hidden),
        [previewFormats],
    );
    const [exportMode, setExportMode] = useState<WizardExportMode>("single");
    const [scale, setScale] = useState(1);
    const [selectedFormatIds, setSelectedFormatIds] = useState<Set<string>>(new Set());
    const [currentExportFormatId, setCurrentExportFormatId] = useState(activeFormatId || previewFormats[0]?.id || "");
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        const nextCurrent = activeFormatId || exportableFormats[0]?.id || previewFormats[0]?.id || "";
        const nextSelected = new Set(exportableFormats.map((format) => format.id));
        queueMicrotask(() => {
            setCurrentExportFormatId(nextCurrent);
            setSelectedFormatIds(nextSelected);
        });
    }, [activeFormatId, exportableFormats, open, previewFormats]);

    const masterSource = previewFormats.find((format) => format.isMaster) ?? previewFormats[0];
    const exportSource = exportableFormats.find((format) => format.id === currentExportFormatId)
        ?? exportableFormats.find((format) => format.id === activeFormatId)
        ?? exportableFormats[0]
        ?? masterSource;
    const exportArtboardProps = useMemo(
        () => formatArtboardProps[exportSource.id]
            ?? resolvePreviewFormatArtboard(exportSource, DEFAULT_ARTBOARD_PROPS),
        [exportSource, formatArtboardProps],
    );
    const entries = useMemo(
        () => getEditableLayerEntries(selectedTemplate, masterSource?.layers ?? []),
        [masterSource?.layers, selectedTemplate],
    );
    const masterCanvasSize = useMemo(
        () => ({ width: masterSource?.width ?? 0, height: masterSource?.height ?? 0 }),
        [masterSource?.height, masterSource?.width],
    );
    const exportLayers = useMemo(() => {
        if (!exportSource) return [];
        const hasOverrides = Object.keys(layerGeometryOverrides).length > 0;
        const sourceLayers = hasOverrides
            ? projectExpansionToResize({
                resizeLayers: exportSource.layers,
                resizeBindings: exportSource.layerBindings,
                resizeArtboard: { width: exportSource.width, height: exportSource.height },
                resizeFormatId: exportSource.id,
                masterArtboard: masterCanvasSize,
                overrides: layerGeometryOverrides,
                imageViewOverrides,
            })
            : exportSource.layers;

        return buildDraftPreviewLayers(
            sourceLayers,
            entries,
            textValues,
            imageValues,
            imageViewOverrides,
            layerStyleOverrides,
        );
    }, [
        entries,
        exportSource,
        imageValues,
        imageViewOverrides,
        layerGeometryOverrides,
        layerStyleOverrides,
        masterCanvasSize,
        masterSource?.id,
        textValues,
    ]);

    if (!exportSource) return null;

    const allFormatIds = exportableFormats.map((format) => format.id);
    const toggleFormat = (id: string) => {
        setSelectedFormatIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const waitForRender = async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const startedAt = Date.now();
        while (!readyRef.current && Date.now() - startedAt < 5000) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (imageLoadStateRef.current.failed > 0) {
            throw new Error("Часть изображений не загрузилась. Проверьте слой и повторите экспорт.");
        }
    };

    const captureCurrent = async () => {
        await waitForRender();
        const stage = stageRef.current;
        if (!stage) throw new Error("Wizard export stage is not ready");
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.batchDraw();
        return withEditorChromeHidden(stage, () => stage.toDataURL({
            x: 0,
            y: 0,
            width: exportSource.width,
            height: exportSource.height,
            pixelRatio: scale,
            mimeType: "image/png",
        }));
    };

    const handleSingleExport = async () => {
        setIsExporting(true);
        setExportError(null);
        try {
            const dataUrl = await captureCurrent();
            const base = sanitizeExportFileName(exportSource.name || exportSource.label || "wizard-export");
            downloadDataUrl(dataUrl, `${base}-${exportSource.width}x${exportSource.height}@${scale}x.png`);
            onClose();
        } catch (err) {
            setExportError(err instanceof Error ? err.message : "Не удалось экспортировать PNG");
        } finally {
            setIsExporting(false);
        }
    };

    const handleBatchExport = async () => {
        const formats = exportableFormats.filter((format) => selectedFormatIds.has(format.id));
        if (formats.length === 0) return;
        setIsExporting(true);
        setExportError(null);
        try {
            const entriesForZip: Array<{ fileName: string; dataUrl: string }> = [];
            for (const format of formats) {
                readyRef.current = false;
                setCurrentExportFormatId(format.id);
                await waitForRender();
                const stage = stageRef.current;
                if (!stage) throw new Error("Сцена экспорта не готова");
                stage.scale({ x: 1, y: 1 });
                stage.position({ x: 0, y: 0 });
                stage.batchDraw();
                const dataUrl = withEditorChromeHidden(stage, () => stage.toDataURL({
                    x: 0,
                    y: 0,
                    width: format.width,
                    height: format.height,
                    pixelRatio: scale,
                    mimeType: "image/png",
                }));
                const base = sanitizeExportFileName(format.name || format.label || format.id);
                entriesForZip.push({
                    fileName: `${base}-${format.width}x${format.height}@${scale}x.png`,
                    dataUrl,
                });
            }
            await zipPngDataUrls(entriesForZip, "wizard-export-batch.zip");
            onClose();
        } catch (err) {
            setExportError(err instanceof Error ? err.message : "Не удалось экспортировать пакет");
        } finally {
            setCurrentExportFormatId(activeFormatId || exportableFormats[0]?.id || previewFormats[0]?.id || "");
            setIsExporting(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Экспорт из мастера"
            maxWidth="max-w-md"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose} disabled={isExporting}>
                        Отмена
                    </Button>
                    {exportMode === "single" ? (
                        <Button onClick={handleSingleExport} icon={<Download size={16} />} disabled={isExporting}>
                            {isExporting ? "Экспорт..." : "Скачать PNG"}
                        </Button>
                    ) : (
                        <Button
                            onClick={handleBatchExport}
                            icon={<Layers size={16} />}
                            disabled={selectedFormatIds.size === 0 || isExporting}
                        >
                            {isExporting ? "Экспорт..." : `Скачать ${selectedFormatIds.size} файл(ов)`}
                        </Button>
                    )}
                </>
            }
        >
            <div className="space-y-4">
                <div className="flex gap-1 rounded-[var(--radius-lg)] border border-border-primary bg-bg-secondary p-1">
                    <button
                        type="button"
                        onClick={() => setExportMode("single")}
                        className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium transition-colors cursor-pointer ${
                            exportMode === "single"
                                ? "border border-border-primary bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                : "text-text-secondary hover:text-text-primary"
                        }`}
                    >
                        <Download size={12} />
                        Единичный
                    </button>
                    <button
                        type="button"
                        onClick={() => setExportMode("batch")}
                        className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium transition-colors cursor-pointer ${
                            exportMode === "batch"
                                ? "border border-border-primary bg-bg-surface text-text-primary shadow-[var(--shadow-sm)]"
                                : "text-text-secondary hover:text-text-primary"
                        }`}
                    >
                        <Layers size={12} />
                        Пакетный
                    </button>
                </div>

                <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-primary">Масштаб</label>
                    <div className="flex gap-2">
                        {[1, 2].map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setScale(value)}
                                className={`h-9 flex-1 rounded-[var(--radius-md)] border text-sm font-medium transition-colors cursor-pointer ${
                                    scale === value
                                        ? "border-accent-primary bg-bg-tertiary text-text-primary"
                                        : "border-border-primary text-text-secondary hover:border-border-secondary"
                                }`}
                            >
                                {value}x
                            </button>
                        ))}
                    </div>
                </div>

                {exportMode === "single" ? (
                    <div className="rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary p-3">
                        <p className="text-sm font-medium text-text-primary">{exportSource.name}</p>
                        <p className="mt-1 text-xs text-text-secondary">
                            {Math.round(exportSource.width * scale)} × {Math.round(exportSource.height * scale)} pixels
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-text-primary">Форматы для экспорта</label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSelectedFormatIds(new Set(allFormatIds))}
                                    className="text-[10px] text-accent-primary hover:underline cursor-pointer"
                                >
                                    Выбрать все
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedFormatIds(new Set())}
                                    className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
                                >
                                    Снять все
                                </button>
                            </div>
                        </div>
                        <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-border-primary p-2">
                            {exportableFormats.map((format) => (
                                <label
                                    key={format.id}
                                    className={`flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] border px-2.5 py-2 transition-colors ${
                                        selectedFormatIds.has(format.id)
                                            ? "border-accent-primary/20 bg-accent-primary/5"
                                            : "border-transparent hover:bg-bg-secondary"
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedFormatIds.has(format.id)}
                                        onChange={() => toggleFormat(format.id)}
                                        className="h-3.5 w-3.5 cursor-pointer rounded border-border-primary accent-[var(--accent-primary)]"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                                        {format.name}
                                    </span>
                                    <span className="text-[10px] text-text-tertiary">
                                        {format.width} × {format.height}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {exportError && (
                    <div className="rounded-[var(--radius-md)] border border-text-error/20 bg-text-error/10 px-3 py-2">
                        <p className="text-[11px] font-medium text-text-error">{exportError}</p>
                    </div>
                )}

                <div className="pointer-events-none fixed -left-[10000px] top-0 opacity-0">
                    <PreviewCanvas
                        ref={stageRef}
                        layers={exportLayers}
                        artboardWidth={exportSource.width}
                        artboardHeight={exportSource.height}
                        containerWidth={exportSource.width}
                        containerHeight={exportSource.height}
                        renderMode="artboard"
                        artboardFill={exportArtboardProps.fill}
                        artboardFillEnabled={exportArtboardProps.fillEnabled !== false}
                        artboardBackgroundImage={exportArtboardProps.backgroundImage}
                        artboardCornerRadius={exportArtboardProps.cornerRadius}
                        artboardStroke={exportArtboardProps.stroke}
                        artboardStrokeMode={exportArtboardProps.strokeMode}
                        artboardStrokeImage={exportArtboardProps.strokeImage}
                        artboardStrokeWidth={exportArtboardProps.strokeWidth}
                        artboardStrokeAlign={exportArtboardProps.strokeAlign}
                        artboardStrokeJoin={exportArtboardProps.strokeJoin}
                        showLayoutGrids={false}
                        onImagesReadyChange={(ready) => {
                            readyRef.current = ready;
                        }}
                        onImageLoadStateChange={(state) => {
                            imageLoadStateRef.current = state;
                        }}
                    />
                </div>
            </div>
        </Modal>
    );
}
