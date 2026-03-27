"use client";

import { useRef, useEffect } from "react";
import { Transformer } from "react-konva";
import Konva from "konva";

/* ─── Selection Transformer ───────────────────────── */
interface SelectionTransformerProps {
    selectedLayerIds: string[];
    stageRef: React.RefObject<Konva.Stage | null>;
    /** IDs to exclude (e.g. children nested inside frames) */
    excludeIds?: Set<string>;
}

export function SelectionTransformer({ selectedLayerIds, stageRef, excludeIds }: SelectionTransformerProps) {
    const trRef = useRef<Konva.Transformer>(null);

    useEffect(() => {
        if (!trRef.current || !stageRef.current) return;

        // Find all selected nodes, excluding frame children
        const filteredIds = excludeIds
            ? selectedLayerIds.filter((id) => !excludeIds.has(id))
            : selectedLayerIds;
        const nodes = filteredIds
            .map((id) => stageRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedLayerIds, stageRef, excludeIds]);

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

    useEffect(() => {
        if (!trRef.current || !containerRef.current) return;

        const nodes = selectedChildIds
            .map((id) => containerRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedChildIds, containerRef]);

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
            anchorSize={6}
            anchorCornerRadius={2}
        />
    );
}
