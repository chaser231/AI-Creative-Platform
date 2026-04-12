"use client";

import { useRef, useEffect } from "react";
import { Transformer } from "react-konva";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";

/* ─── Selection Transformer ───────────────────────── */
interface SelectionTransformerProps {
    selectedLayerIds: string[];
    stageRef: React.RefObject<Konva.Stage | null>;
    /** IDs to exclude (e.g. children nested inside frames) */
    excludeIds?: Set<string>;
}

export function SelectionTransformer({ selectedLayerIds, stageRef, excludeIds }: SelectionTransformerProps) {
    const trRef = useRef<Konva.Transformer>(null);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);

    useEffect(() => {
        if (!trRef.current || !stageRef.current) return;

        // Find all selected nodes, excluding frame children AND the currently editing text layer
        const filteredIds = selectedLayerIds.filter((id) => {
            if (excludeIds?.has(id)) return false;
            if (editingLayerId && id === editingLayerId) return false;
            return true;
        });
        const nodes = filteredIds
            .map((id) => stageRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedLayerIds, stageRef, excludeIds, editingLayerId]);

    return (
        <Transformer
            ref={trRef}
            boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
            }}
            borderStroke="#6366F1"
            anchorStroke="#6366F1"
            anchorFill="#FFFFFF"
            anchorSize={8}
            anchorCornerRadius={2}
        />
    );
}

/* ─── Inner Transformer for Frame Children ────────── */
interface FrameChildTransformerProps {
    selectedChildIds: string[];
    containerRef: React.RefObject<Konva.Group | null>;
}

export function FrameChildTransformer({ selectedChildIds, containerRef }: FrameChildTransformerProps) {
    const trRef = useRef<Konva.Transformer>(null);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);
    const layers = useCanvasStore((s) => s.layers);

    useEffect(() => {
        if (!trRef.current || !containerRef.current) return;

        // Exclude the currently editing text layer from the transformer
        const filteredIds = editingLayerId
            ? selectedChildIds.filter((id) => id !== editingLayerId)
            : selectedChildIds;

        const nodes = filteredIds
            .map((id) => containerRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedChildIds, containerRef, editingLayerId]);

    // Live transform handler: reset text scale to prevent visual stretching
    const handleTransform = () => {
        const tr = trRef.current;
        if (!tr) return;
        const nodes = tr.nodes();
        nodes.forEach((node) => {
            const layer = layers.find(l => l.id === node.id());
            if (layer?.type === "text") {
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
                    const newWidth = Math.max(node.width() * scaleX, 10);
                    const newHeight = Math.max(node.height() * scaleY, 10);
                    node.scaleX(1);
                    node.scaleY(1);
                    node.width(newWidth);
                    node.height(newHeight);
                }
            }
        });
    };

    return (
        <Transformer
            ref={trRef}
            onTransform={handleTransform}
            boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
            }}
            borderStroke="#6366F1"
            anchorStroke="#6366F1"
            anchorFill="#FFFFFF"
            anchorSize={6}
            anchorCornerRadius={2}
        />
    );
}
