"use client";

import {
    Eye,
    EyeOff,
    Type,
    Square,
    SquareDashed,
    ImageIcon,
    Award,
    Trash2,
    ChevronRight,
    ChevronDown,
    GripVertical,
} from "lucide-react";
import { useCanvasStore } from "@/store/canvasStore";
import type { FrameLayer } from "@/types";
import { cn } from "@/lib/cn";
import { useState, useRef } from "react";
import { ContextMenu, buildLayerContextMenuItems } from "./ContextMenu";

const layerIcons: Record<string, React.ReactNode> = {
    text: <Type size={14} />,
    rectangle: <Square size={14} />,
    image: <ImageIcon size={14} />,
    badge: <Award size={14} />,
    frame: <SquareDashed size={14} />,
};

/* ─── Drag-and-drop context ─────────────────────────── */
let draggedLayerId: string | null = null;

function LayerRow({
    layer,
    depth = 0,
}: {
    layer: ReturnType<typeof useCanvasStore.getState>["layers"][number];
    depth?: number;
}) {
    const {
        layers,
        selectedLayerIds,
        selectLayer,
        toggleSelection,
        toggleLayerVisibility,
        toggleLayerLock,
        removeLayer,
        duplicateLayer,
        duplicateSelectedLayers,
        deleteSelectedLayers,
        bringToFront,
        sendToBack,
        updateLayer,
        moveLayerToFrame,
        removeLayerFromFrame
    } = useCanvasStore();

    const [expanded, setExpanded] = useState(true);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameName, setRenameName] = useState("");
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const isFrame = layer.type === "frame";
    const childLayers = isFrame
        ? (layer as FrameLayer).childIds
            .map((id) => layers.find((l) => l.id === id))
            .filter(Boolean) as typeof layers
        : [];

    const isSelected = selectedLayerIds.includes(layer.id);

    const handleDragStart = (e: React.DragEvent) => {
        e.stopPropagation();
        draggedLayerId = layer.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", layer.id);

        // If the dragged layer is selected, we conceptually drag the selection.
        // We don't change the drag image here nicely without custom code, 
        // but logic-wise we will handle it in drop.

        if (rowRef.current) {
            rowRef.current.style.opacity = "0.5";
        }
    };

    const handleDragEnd = (e: React.DragEvent) => {
        e.stopPropagation();
        draggedLayerId = null;
        if (rowRef.current) {
            rowRef.current.style.opacity = "1";
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedLayerId) return;

        // Don't drop into self
        if (draggedLayerId === layer.id) return;

        // Don't drop selection into one of its own members (if multiple)
        if (selectedLayerIds.includes(draggedLayerId) && selectedLayerIds.includes(layer.id)) return;

        // Prevent dropping a frame onto itself or its own children
        if (isFrame) {
            const frame = layer as FrameLayer;
            if (frame.childIds.includes(draggedLayerId)) return;
        }

        setIsDragOver(true);
        e.dataTransfer.dropEffect = "move";
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        if (!draggedLayerId) return;
        // Don't drop into self
        if (draggedLayerId === layer.id) return;

        // Prevent dropping a frame into itself (simple check for single drag)
        const draggedLayer = layers.find((l) => l.id === draggedLayerId);
        if (draggedLayer?.type === "frame" && draggedLayer.id === layer.id) return; // Should be caught above

        if (isFrame) {
            // Drop onto a frame → nest inside it
            // Logic: if draggedLayerId is selected, move all selected.
            // Else move just draggedLayerId.

            const movingIds = (selectedLayerIds.includes(draggedLayerId))
                ? selectedLayerIds
                : [draggedLayerId];

            movingIds.forEach(id => {
                // Avoid circular logic if we try to move frame into itself or child
                // (Simplified check: assume store handles or we accept edge case for now)
                moveLayerToFrame(id, layer.id);
            });

            setExpanded(true);
        }

        draggedLayerId = null;
    };

    const handleClick = (e: React.MouseEvent) => {
        const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
        if (isMulti) {
            toggleSelection(layer.id);
        } else {
            selectLayer(layer.id);
        }
    };

    return (
        <>
            <div
                ref={rowRef}
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClick}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // If right clicking something not in selection, select it
                    if (!isSelected) {
                        selectLayer(layer.id);
                    }
                    setCtxMenu({ x: e.clientX, y: e.clientY });
                }}
                className={cn(
                    "group flex items-center gap-1 py-1.5 mx-1 rounded-[var(--radius-sm)] cursor-pointer transition-colors",
                    isSelected
                        ? "bg-bg-tertiary"
                        : "hover:bg-bg-secondary",
                    isDragOver && isFrame && "ring-2 ring-accent-primary ring-inset bg-accent-primary/5"
                )}
                style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: 8 }}
            >
                {/* Drag handle */}
                <span className="shrink-0 text-text-tertiary opacity-0 group-hover:opacity-40 cursor-grab">
                    <GripVertical size={10} />
                </span>

                {/* Expand/collapse for frames */}
                {isFrame ? (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(!expanded);
                        }}
                        className="p-0.5 shrink-0 text-text-tertiary hover:text-text-primary cursor-pointer"
                    >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                ) : (
                    <span className="w-4 shrink-0" />
                )}

                {/* Icon */}
                <span className="text-text-tertiary shrink-0">
                    {layerIcons[layer.type]}
                </span>

                {/* Name — inline rename or static */}
                {isRenaming ? (
                    <input
                        ref={renameInputRef}
                        autoFocus
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onBlur={() => {
                            if (renameName.trim()) updateLayer(layer.id, { name: renameName.trim() });
                            setIsRenaming(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                if (renameName.trim()) updateLayer(layer.id, { name: renameName.trim() });
                                setIsRenaming(false);
                            }
                            if (e.key === "Escape") setIsRenaming(false);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 text-xs bg-bg-primary border border-border-focus rounded px-1 py-0.5 text-text-primary outline-none min-w-0"
                    />
                ) : (
                    <span
                        className={cn(
                            "flex-1 text-xs truncate",
                            layer.visible ? "text-text-primary" : "text-text-tertiary"
                        )}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenameName(layer.name);
                            setIsRenaming(true);
                        }}
                    >
                        {layer.name}
                    </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleLayerVisibility(layer.id);
                        }}
                        className="p-1 rounded hover:bg-bg-tertiary cursor-pointer"
                    >
                        {layer.visible ? (
                            <Eye size={12} className="text-text-tertiary" />
                        ) : (
                            <EyeOff size={12} className="text-text-tertiary" />
                        )}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            // If removing selected, maybe use deleteSelectedLayers if in selection?
                            // But trash icon is on specific row. User expects THAT row to delete.
                            // If that row is part of selection, deleting just it might be confusing if others stay selected.
                            // Usually "Delete" button near a layer deletes JUST that layer.
                            removeLayer(layer.id);
                        }}
                        className="p-1 rounded hover:bg-red-100 cursor-pointer"
                    >
                        <Trash2 size={12} className="text-text-tertiary hover:text-red-500" />
                    </button>
                </div>
            </div>

            {/* Nested children for frames */}
            {isFrame && expanded && childLayers.map((child) => (
                <LayerRow key={child.id} layer={child} depth={depth + 1} />
            ))}

            {/* Context menu for this layer */}
            {ctxMenu && (
                <ContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    onClose={() => setCtxMenu(null)}
                    items={buildLayerContextMenuItems(
                        layer.id,
                        layer.name,
                        layer.visible,
                        layer.locked,
                        {
                            // If selected, use bulk actions?
                            // But context menu is specific to the row clicked?
                            // Standard behavior: context menu on selection acts on selection.
                            // If isSelected is true:
                            duplicate: isSelected ? duplicateSelectedLayers : () => duplicateLayer(layer.id),
                            remove: isSelected ? deleteSelectedLayers : () => removeLayer(layer.id),

                            bringToFront: () => bringToFront(layer.id),
                            sendToBack: () => sendToBack(layer.id),
                            toggleVisibility: () => toggleLayerVisibility(layer.id),
                            toggleLock: () => toggleLayerLock(layer.id),
                            rename: () => {
                                setRenameName(layer.name);
                                setIsRenaming(true);
                            },
                        }
                    )}
                />
            )}
        </>
    );
}

export function LayersPanel() {
    const { layers, selectedLayerIds, removeLayerFromFrame } = useCanvasStore();
    const [isDragOverRoot, setIsDragOverRoot] = useState(false);

    // Build set of all child IDs to exclude from top-level
    const childIdSet = new Set<string>();
    layers.forEach((l) => {
        if (l.type === "frame") {
            (l as FrameLayer).childIds.forEach((id) => childIdSet.add(id));
        }
    });

    const topLevelLayers = [...layers].filter((l) => !childIdSet.has(l.id)).reverse();

    // Handle drop on root area (un-nest from frame)
    const handleRootDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!draggedLayerId) return;
        // Only show indicator if the dragged layer is currently in a frame
        const isNested = childIdSet.has(draggedLayerId);
        if (isNested) {
            setIsDragOverRoot(true);
            e.dataTransfer.dropEffect = "move";
        }
    };

    const handleRootDragLeave = () => {
        setIsDragOverRoot(false);
    };

    const handleRootDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOverRoot(false);
        if (!draggedLayerId) return;

        // Un-nest from frame
        // Multi-drag logic
        const movingIds = (selectedLayerIds.includes(draggedLayerId))
            ? selectedLayerIds
            : [draggedLayerId];

        movingIds.forEach(id => {
            if (childIdSet.has(id)) {
                removeLayerFromFrame(id);
            }
        });

        draggedLayerId = null;
    };

    return (
        <div className="w-[220px] min-w-[220px] h-full border border-border-primary rounded-[var(--radius-2xl)] shadow-[var(--shadow-md)] flex flex-col overflow-hidden backdrop-blur-xl bg-bg-surface/85">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border-primary">
                <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-widest">
                    Слои
                </h3>
            </div>

            {/* Layer List */}
            <div
                className={cn(
                    "flex-1 overflow-y-auto py-1 transition-colors",
                    isDragOverRoot && "bg-accent-primary/5"
                )}
                onDragOver={handleRootDragOver}
                onDragLeave={handleRootDragLeave}
                onDrop={handleRootDrop}
            >
                {topLevelLayers.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <p className="text-xs text-text-tertiary">
                            Слоёв пока нет. Используйте панель инструментов.
                        </p>
                    </div>
                ) : (
                    topLevelLayers.map((layer) => (
                        <LayerRow key={layer.id} layer={layer} />
                    ))
                )}
            </div>
        </div>
    );
}
