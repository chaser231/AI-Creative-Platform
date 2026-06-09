"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Download, Layers, Package } from "lucide-react";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import type { FrameLayer } from "@/types";
import { cn } from "@/lib/cn";
import { downloadDataUrl, zipPngDataUrls, zipTextFiles } from "@/utils/exportImage";
import { getCanvasStateForSave } from "@/utils/canvasState";
import { layersToSvg, layersToSvgFragment } from "@/services/svgExport";
import { layersToEps, layersToEpsFragment } from "@/services/epsExport";
import { collectLayerTree } from "@/utils/clipboardUtils";
import type { Layer } from "@/types";

interface ExportModalProps {
    open: boolean;
    onClose: () => void;
    stageRef: React.RefObject<Konva.Stage | null>;
}

function TransparentBackgroundOption({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary p-3 cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 accent-accent-primary"
            />
            <span>
                <span className="block text-sm font-medium text-text-primary">Прозрачный фон PNG</span>
                <span className="block text-[11px] text-text-tertiary">
                    Скрывает заливку и фоновое изображение артборда на время экспорта. Тень артборда не попадает в PNG.
                </span>
            </span>
        </label>
    );
}

type ExportTarget = "artboard" | string; // "artboard" or frame id
type ExportMode = "single" | "batch" | "template";

export function ExportModal({ open, onClose, stageRef }: ExportModalProps) {
    const [scale, setScale] = useState(1);
    const [exportMode, setExportMode] = useState<ExportMode>("single");
    const [exportTarget, setExportTarget] = useState<ExportTarget>("artboard");
    const [exportFormat, setExportFormat] = useState<"png" | "svg" | "eps">("png");
    const [selectedResizes, setSelectedResizes] = useState<Set<string>>(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [transparentBackground, setTransparentBackground] = useState(false);

    const { canvasWidth, canvasHeight, layers, resizes, setActiveResize, activeResizeId, artboardProps } = useCanvasStore(useShallow((s) => ({
        canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, layers: s.layers,
        resizes: s.resizes, setActiveResize: s.setActiveResize,
        activeResizeId: s.activeResizeId, artboardProps: s.artboardProps,
    })));

    // Get all frames for export target selector
    const frames = layers.filter((l) => l.type === "frame") as FrameLayer[];

    // Initialize selected resizes on open
    const allResizeIds = resizes.map((r) => r.id);
    if (selectedResizes.size === 0 && resizes.length > 0) {
        // Auto-select all on first render
        const initial = new Set(allResizeIds);
        if (initial.size !== selectedResizes.size) {
            // Will be set on next interaction
        }
    }

    const toggleResize = (id: string) => {
        setSelectedResizes((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAllResizes = () => {
        setSelectedResizes(new Set(allResizeIds));
    };

    const deselectAllResizes = () => {
        setSelectedResizes(new Set());
    };

    // Get export dimensions based on target
    const getExportBounds = useCallback(() => {
        if (exportTarget === "artboard") {
            return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
        }
        // Export a specific frame
        const frame = layers.find((l) => l.id === exportTarget) as FrameLayer | undefined;
        if (frame) {
            return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
        }
        return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    }, [exportTarget, canvasWidth, canvasHeight, layers]);

    const captureDataUrl = useCallback((stage: Konva.Stage, bounds: { x: number; y: number; width: number; height: number }) => {
        const restore: Array<() => void> = [];
        stage.find(".export-artboard-fill").forEach((node) => {
            const shape = node as Konva.Shape;
            const prevShadowBlur = shape.shadowBlur();
            const prevShadowEnabled = shape.shadowEnabled();
            const prevFill = shape.fill();
            const prevFillPriority = shape.fillPriority();
            restore.push(() => {
                shape.shadowBlur(prevShadowBlur);
                shape.shadowEnabled(prevShadowEnabled);
                shape.fill(prevFill);
                shape.fillPriority(prevFillPriority);
            });
            shape.shadowBlur(0);
            shape.shadowEnabled(false);
            if (transparentBackground) {
                shape.fill("transparent");
                shape.fillPriority("color");
            }
        });
        if (transparentBackground) {
            stage.find(".export-artboard-background").forEach((node) => {
                const prevVisible = node.visible();
                restore.push(() => node.visible(prevVisible));
                node.visible(false);
            });
        }

        stage.batchDraw();
        try {
            return stage.toDataURL({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
                pixelRatio: scale,
                mimeType: "image/png",
            });
        } finally {
            restore.reverse().forEach((fn) => fn());
            stage.batchDraw();
        }
    }, [scale, transparentBackground]);

    const doExport = useCallback((fileName: string) => {
        const stage = stageRef.current;
        if (!stage) return;

        const bounds = getExportBounds();

        // Save the original view state
        const oldScale = stage.scaleX();
        const oldX = stage.x();
        const oldY = stage.y();

        // Reset for clean export
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });

        const dataURL = captureDataUrl(stage, bounds);

        // Restore
        stage.scale({ x: oldScale, y: oldScale });
        stage.position({ x: oldX, y: oldY });
        stage.batchDraw();

        downloadDataUrl(dataURL, fileName);
    }, [stageRef, getExportBounds, captureDataUrl]);

    const downloadSvg = useCallback((svg: string, fileName: string) => {
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    }, []);

    const handleSvgExport = useCallback(async () => {
        const targetName = exportTarget === "artboard"
            ? "artboard"
            : (layers.find((l) => l.id === exportTarget)?.name || "frame");
        setIsExporting(true);
        try {
            const [{ buildOutlinedTextMap }, { buildEmbeddedImageMap }] = await Promise.all([
                import("@/services/exportText"),
                import("@/services/exportImages"),
            ]);
            const { promoteFigmaVectorImagesForExport } = await import("@/lib/figma/vectorPromotion");
            const exportLayers = await promoteFigmaVectorImagesForExport(layers as Layer[]);
            const outlinedText = await buildOutlinedTextMap(stageRef.current, exportLayers);
            const embeddedImages = await buildEmbeddedImageMap(exportLayers);

            let svg: string;
            if (exportTarget === "artboard") {
                svg = layersToSvg({
                    layers: exportLayers,
                    width: canvasWidth,
                    height: canvasHeight,
                    artboardFill: artboardProps.fill,
                    artboardFillEnabled: !transparentBackground && artboardProps.fillEnabled !== false,
                    outlinedText,
                    embeddedImages,
                });
            } else {
                const subtree = collectLayerTree([exportTarget], exportLayers);
                svg = subtree.length ? layersToSvgFragment(subtree, outlinedText) : "";
            }
            if (svg) downloadSvg(svg, `${targetName}.svg`);
        } finally {
            setIsExporting(false);
            onClose();
        }
    }, [exportTarget, layers, canvasWidth, canvasHeight, artboardProps, transparentBackground, downloadSvg, onClose, stageRef]);

    const handleEpsExport = useCallback(async () => {
        const targetName = exportTarget === "artboard"
            ? "artboard"
            : (layers.find((l) => l.id === exportTarget)?.name || "frame");
        setIsExporting(true);
        try {
            const [{ buildOutlinedTextMap }, { promoteFigmaVectorImagesForExport }] = await Promise.all([
                import("@/services/exportText"),
                import("@/lib/figma/vectorPromotion"),
            ]);
            const exportLayers = await promoteFigmaVectorImagesForExport(layers as Layer[]);
            const outlinedText = await buildOutlinedTextMap(stageRef.current, exportLayers);

            let eps: string;
            if (exportTarget !== "artboard") {
                const subtree = collectLayerTree([exportTarget], exportLayers);
                eps = layersToEpsFragment(subtree, outlinedText);
            } else {
                eps = layersToEps({
                    layers: exportLayers,
                    width: canvasWidth,
                    height: canvasHeight,
                    artboardFill: artboardProps.fill,
                    artboardFillEnabled: !transparentBackground && artboardProps.fillEnabled !== false,
                    outlinedText,
                });
            }
            const blob = new Blob([eps], { type: "application/postscript" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${targetName}.eps`;
            link.click();
            URL.revokeObjectURL(url);
        } finally {
            setIsExporting(false);
            onClose();
        }
    }, [exportTarget, layers, canvasWidth, canvasHeight, artboardProps, transparentBackground, onClose, stageRef]);

    const handleSingleExport = () => {
        if (exportFormat === "svg") {
            void handleSvgExport();
            return;
        }
        if (exportFormat === "eps") {
            void handleEpsExport();
            return;
        }
        const bounds = getExportBounds();
        const targetName = exportTarget === "artboard"
            ? "artboard"
            : (layers.find((l) => l.id === exportTarget)?.name || "frame");
        doExport(`${targetName}-${bounds.width}x${bounds.height}@${scale}x.png`);
        onClose();
    };

    const handleBatchExport = async () => {
        const stage = stageRef.current;
        if (!stage) return;

        const resizesToExport = resizes.filter((r) => selectedResizes.has(r.id));
        if (resizesToExport.length === 0) return;

        setIsExporting(true);

        const originalResizeId = activeResizeId;
        const oldScale = stage.scaleX();
        const oldX = stage.x();
        const oldY = stage.y();

        try {
            if (exportFormat === "svg" || exportFormat === "eps") {
                const [{ buildOutlinedTextMap }, { buildEmbeddedImageMap }, { promoteFigmaVectorImagesForExport }] = await Promise.all([
                    import("@/services/exportText"),
                    import("@/services/exportImages"),
                    import("@/lib/figma/vectorPromotion"),
                ]);
                const vectorEntries: Array<{ fileName: string; content: string }> = [];

                for (const resize of resizesToExport) {
                    setActiveResize(resize.id);
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    const state = useCanvasStore.getState();
                    const exportLayers = await promoteFigmaVectorImagesForExport(state.layers as Layer[]);
                    const outlinedText = await buildOutlinedTextMap(stage, exportLayers);
                    const embeddedImages = exportFormat === "svg"
                        ? await buildEmbeddedImageMap(exportLayers)
                        : undefined;

                    const content = exportFormat === "svg"
                        ? layersToSvg({
                            layers: exportLayers,
                            width: state.canvasWidth,
                            height: state.canvasHeight,
                            artboardFill: state.artboardProps.fill,
                            artboardFillEnabled: !transparentBackground && state.artboardProps.fillEnabled !== false,
                            outlinedText,
                            embeddedImages,
                        })
                        : layersToEps({
                            layers: state.layers as Layer[],
                            width: state.canvasWidth,
                            height: state.canvasHeight,
                            artboardFill: state.artboardProps.fill,
                            artboardFillEnabled: !transparentBackground && state.artboardProps.fillEnabled !== false,
                            outlinedText,
                        });

                    vectorEntries.push({
                        fileName: `${resize.name}-${resize.width}x${resize.height}.${exportFormat}`,
                        content,
                    });
                }

                await zipTextFiles(vectorEntries, `export-batch-${exportFormat}.zip`);
            } else {
                const pngEntries: Array<{ fileName: string; dataUrl: string }> = [];

                for (const resize of resizesToExport) {
                    setActiveResize(resize.id);
                    await new Promise((resolve) => setTimeout(resolve, 200));

                    stage.scale({ x: 1, y: 1 });
                    stage.position({ x: 0, y: 0 });
                    stage.batchDraw();

                    const dataURL = captureDataUrl(stage, {
                        x: 0,
                        y: 0,
                        width: resize.width,
                        height: resize.height,
                    });

                    pngEntries.push({
                        fileName: `${resize.name}-${resize.width}x${resize.height}@${scale}x.png`,
                        dataUrl: dataURL,
                    });
                }

                await zipPngDataUrls(pngEntries, "export-batch.zip");
            }
        } finally {
            setActiveResize(originalResizeId);
            stage.scale({ x: oldScale, y: oldScale });
            stage.position({ x: oldX, y: oldY });
            stage.batchDraw();
            setIsExporting(false);
            onClose();
        }
    };

    const bounds = getExportBounds();

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Экспорт ассета"
            maxWidth="max-w-md"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>
                        Отмена
                    </Button>
                    {exportMode === "single" ? (
                        <Button onClick={handleSingleExport} icon={<Download size={16} />}>
                            {exportFormat === "svg" ? "Скачать SVG" : exportFormat === "eps" ? "Скачать EPS" : "Скачать PNG"}
                        </Button>
                    ) : exportMode === "batch" ? (
                        <Button
                            onClick={handleBatchExport}
                            icon={<Package size={16} />}
                            disabled={selectedResizes.size === 0 || isExporting}
                        >
                            {isExporting ? "Экспорт..." : `Скачать ${selectedResizes.size} файл(ов)`}
                        </Button>
                    ) : (
                        <Button
                            onClick={() => {
                                import("@/services/templateService").then(({ serializeTemplate }) => {
                                    const state = getCanvasStateForSave(useCanvasStore.getState());
                                    const pack = serializeTemplate({}, state.masterComponents, state.resizes, state.componentInstances, state.layers, {
                                        artboardProps: state.artboardProps as unknown as Record<string, unknown>,
                                        palette: state.palette,
                                        canvasWidth: state.canvasWidth,
                                        canvasHeight: state.canvasHeight,
                                    });
                                    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
                                    const url = URL.createObjectURL(blob);
                                    const link = document.createElement("a");
                                    link.href = url;
                                    link.download = "template-pack.json";
                                    link.click();
                                    URL.revokeObjectURL(url);
                                    onClose();
                                });
                            }}
                            icon={<Package size={16} />}
                        >
                            Скачать .json
                        </Button>
                    )}
                </>
            }
        >
            <div className="space-y-4">
                {/* Mode tabs */}
                <div className="flex gap-1 p-1 bg-bg-secondary rounded-[var(--radius-lg)] border border-border-primary">
                    <button
                        onClick={() => setExportMode("single")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer",
                            exportMode === "single"
                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                        )}
                    >
                        <Download size={12} />
                        Единичный
                    </button>
                    <button
                        onClick={() => {
                            setExportMode("batch");
                            setSelectedResizes(new Set(allResizeIds));
                        }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer",
                            exportMode === "batch"
                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                        )}
                    >
                        <Layers size={12} />
                        Пакетный
                    </button>
                    <button
                        onClick={() => setExportMode("template")}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[var(--radius-md)] text-xs font-medium transition-all cursor-pointer",
                            exportMode === "template"
                                ? "bg-bg-surface text-text-primary shadow-[var(--shadow-sm)] border border-border-primary"
                                : "text-text-secondary hover:text-text-primary"
                        )}
                    >
                        <Package size={12} />
                        Шаблон
                    </button>
                </div>

                {exportMode === "single" ? (
                    <>
                        {/* Export target selector */}
                        {frames.length > 0 && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-text-primary">Объект экспорта</label>
                                <Select
                                    value={exportTarget}
                                    onChange={(val) => setExportTarget(val)}
                                    options={[
                                        { value: "artboard", label: `Артборд (${canvasWidth} × ${canvasHeight})` },
                                        ...frames.map((frame) => ({
                                            value: frame.id,
                                            label: `${frame.name} (${Math.round(frame.width)} × ${Math.round(frame.height)})`,
                                        })),
                                    ]}
                                />
                            </div>
                        )}

                        {/* Format selector */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-primary">Формат</label>
                            <div className="flex gap-2">
                                {(["png", "svg", "eps"] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setExportFormat(f)}
                                        className={`flex-1 h-9 rounded-[var(--radius-md)] text-sm font-medium border transition-all cursor-pointer uppercase ${exportFormat === f
                                            ? "border-accent-primary bg-bg-tertiary text-text-primary"
                                            : "border-border-primary text-text-secondary hover:border-border-secondary"
                                            }`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Preview info */}
                        <div className="p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                            <p className="text-sm text-text-primary font-medium">
                                {exportFormat === "svg" ? "Экспорт SVG (вектор)" : exportFormat === "eps" ? "Экспорт EPS (вектор)" : "Экспорт PNG"}
                            </p>
                            <p className="text-xs text-text-secondary mt-1">
                                {exportFormat !== "png"
                                    ? `${Math.round(bounds.width)} × ${Math.round(bounds.height)} (масштабируемый)`
                                    : `${Math.round(bounds.width * scale)} × ${Math.round(bounds.height * scale)} pixels`}
                            </p>
                        </div>

                        {/* Scale selector (PNG only) */}
                        {exportFormat === "png" && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-text-primary">Масштаб</label>
                                <div className="flex gap-2">
                                    {[1, 2].map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setScale(s)}
                                            className={`flex-1 h-9 rounded-[var(--radius-md)] text-sm font-medium border transition-all cursor-pointer ${scale === s
                                                ? "border-accent-primary bg-bg-tertiary text-text-primary"
                                                : "border-border-primary text-text-secondary hover:border-border-secondary"
                                                }`}
                                        >
                                            {s}x
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <TransparentBackgroundOption
                            checked={transparentBackground}
                            onChange={setTransparentBackground}
                        />
                    </>
                ) : exportMode === "batch" ? (
                    <>
                        {/* Format selector (batch) */}
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-primary">Формат</label>
                            <div className="flex gap-2">
                                {(["png", "svg", "eps"] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setExportFormat(f)}
                                        className={`flex-1 h-9 rounded-[var(--radius-md)] text-sm font-medium border transition-all cursor-pointer uppercase ${exportFormat === f
                                            ? "border-accent-primary bg-bg-tertiary text-text-primary"
                                            : "border-border-primary text-text-secondary hover:border-border-secondary"
                                            }`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Batch export: resize list */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-text-primary">Форматы для экспорта</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={selectAllResizes}
                                        className="text-[10px] text-accent-primary hover:underline cursor-pointer"
                                    >
                                        Выбрать все
                                    </button>
                                    <button
                                        onClick={deselectAllResizes}
                                        className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
                                    >
                                        Снять все
                                    </button>
                                </div>
                            </div>

                            <div className="max-h-48 overflow-y-auto space-y-1 border border-border-primary rounded-[var(--radius-md)] p-2">
                                {resizes.map((resize) => (
                                    <label
                                        key={resize.id}
                                        className={cn(
                                            "flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] cursor-pointer transition-colors",
                                            selectedResizes.has(resize.id)
                                                ? "bg-accent-primary/5 border border-accent-primary/20"
                                                : "border border-transparent hover:bg-bg-secondary"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedResizes.has(resize.id)}
                                            onChange={() => toggleResize(resize.id)}
                                            className="w-3.5 h-3.5 rounded border-border-primary accent-[var(--accent-primary)] cursor-pointer"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs text-text-primary font-medium">{resize.name}</span>
                                            <span className="text-[10px] text-text-tertiary ml-2">
                                                {resize.width} × {resize.height}
                                            </span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Scale selector for batch (PNG only) */}
                        {exportFormat === "png" && (
                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-text-primary">Масштаб</label>
                                <div className="flex gap-2">
                                    {[1, 2].map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setScale(s)}
                                            className={`flex-1 h-9 rounded-[var(--radius-md)] text-sm font-medium border transition-all cursor-pointer ${scale === s
                                                ? "border-accent-primary bg-bg-tertiary text-text-primary"
                                                : "border-border-primary text-text-secondary hover:border-border-secondary"
                                                }`}
                                        >
                                            {s}x
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <TransparentBackgroundOption
                            checked={transparentBackground}
                            onChange={setTransparentBackground}
                        />

                        {/* Batch preview */}
                        <div className="p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                            <p className="text-xs text-text-secondary">
                                Будет экспортировано <span className="text-text-primary font-medium">{selectedResizes.size}</span> файл(ов) в формате PNG @{scale}x
                            </p>
                        </div>
                    </>
                ) : (
                    <>
                        {/* Template Export Info */}
                        <div className="p-4 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary space-y-2">
                            <Package className="text-accent-primary mb-1" size={24} />
                            <p className="text-sm text-text-primary font-medium">
                                Экспорт пакета шаблонов
                            </p>
                            <p className="text-xs text-text-secondary">
                                Сохраняет текущую структуру проекта (Мастер-компоненты, слоты, форматы) в файл .json для повторного использования.
                            </p>
                            <p className="text-xs text-text-tertiary pt-2 border-t border-border-secondary">
                                Конкретный контент инстансов не сохраняется, но структура и правила лэйаута будут экспортированы.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}
