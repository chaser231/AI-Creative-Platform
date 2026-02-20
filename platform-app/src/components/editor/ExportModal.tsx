"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Download, Layers, Package } from "lucide-react";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import type { FrameLayer } from "@/types";
import { cn } from "@/lib/cn";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface ExportModalProps {
    open: boolean;
    onClose: () => void;
    stageRef: React.RefObject<Konva.Stage | null>;
}

type ExportTarget = "artboard" | string; // "artboard" or frame id
type ExportMode = "single" | "batch" | "template";

export function ExportModal({ open, onClose, stageRef }: ExportModalProps) {
    const [scale, setScale] = useState(1);
    const [exportMode, setExportMode] = useState<ExportMode>("single");
    const [exportTarget, setExportTarget] = useState<ExportTarget>("artboard");
    const [selectedResizes, setSelectedResizes] = useState<Set<string>>(new Set());
    const [isExporting, setIsExporting] = useState(false);

    const { canvasWidth, canvasHeight, layers, resizes, setActiveResize, activeResizeId, artboardProps } = useCanvasStore();

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

        const dataURL = stage.toDataURL({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            pixelRatio: scale,
            mimeType: "image/png",
        });

        // Restore
        stage.scale({ x: oldScale, y: oldScale });
        stage.position({ x: oldX, y: oldY });
        stage.batchDraw();

        // Download
        const link = document.createElement("a");
        link.download = fileName;
        link.href = dataURL;
        link.click();
    }, [stageRef, getExportBounds, scale]);

    const handleSingleExport = () => {
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

        // Save current state
        const originalResizeId = activeResizeId;
        const oldScale = stage.scaleX();
        const oldX = stage.x();
        const oldY = stage.y();

        const zip = new JSZip();

        for (const resize of resizesToExport) {
            // Switch to resize
            setActiveResize(resize.id);

            // Wait for render
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Reset for clean export
            stage.scale({ x: 1, y: 1 });
            stage.position({ x: 0, y: 0 });
            stage.batchDraw();

            const dataURL = stage.toDataURL({
                x: 0,
                y: 0,
                width: resize.width,
                height: resize.height,
                pixelRatio: scale,
                mimeType: "image/png",
            });

            // Add the image to the zip file
            const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
            zip.file(`${resize.name}-${resize.width}x${resize.height}@${scale}x.png`, base64Data, { base64: true });
        }

        // Generate and download the zip file
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "export-batch.zip");

        // Restore original state
        setActiveResize(originalResizeId);
        stage.scale({ x: oldScale, y: oldScale });
        stage.position({ x: oldX, y: oldY });
        stage.batchDraw();

        setIsExporting(false);
        onClose();
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
                            Скачать PNG
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
                                    const { masterComponents, resizes, layers } = useCanvasStore.getState();
                                    const pack = serializeTemplate({}, masterComponents, resizes);
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
                                <select
                                    value={exportTarget}
                                    onChange={(e) => setExportTarget(e.target.value)}
                                    className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-border-primary bg-bg-secondary text-sm text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-border-focus"
                                >
                                    <option value="artboard">Артборд ({canvasWidth} × {canvasHeight})</option>
                                    {frames.map((frame) => (
                                        <option key={frame.id} value={frame.id}>
                                            {frame.name} ({Math.round(frame.width)} × {Math.round(frame.height)})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Preview info */}
                        <div className="p-3 bg-bg-secondary rounded-[var(--radius-md)] border border-border-primary">
                            <p className="text-sm text-text-primary font-medium">
                                Экспорт PNG
                            </p>
                            <p className="text-xs text-text-secondary mt-1">
                                {Math.round(bounds.width * scale)} × {Math.round(bounds.height * scale)} pixels
                            </p>
                        </div>

                        {/* Scale selector */}
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
                    </>
                ) : exportMode === "batch" ? (
                    <>
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

                        {/* Scale selector for batch */}
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
