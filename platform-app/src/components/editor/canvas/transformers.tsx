"use client";

import { useRef, useEffect } from "react";
import { Transformer } from "react-konva";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import { enforceLockedAspectOnNode, isLayerAspectLocked } from "@/utils/aspectRatioLock";
import { applyAspectRatioToSideAnchor } from "@/utils/transformBox";
import { normalizeLiveTextTransform } from "./textTransformUtils";

/* ─── Selection Transformer ───────────────────────── */
interface SelectionTransformerProps {
    selectedLayerIds: string[];
    stageRef: React.RefObject<Konva.Stage | null>;
    /** IDs to exclude (e.g. children nested inside frames) */
    excludeIds?: Set<string>;
}

function selectionUsesTransformerKeepRatio(
    selectedLayerIds: string[],
    layers: ReturnType<typeof useCanvasStore.getState>["layers"],
    excludeIds?: Set<string>,
): boolean {
    const ids = selectedLayerIds.filter((id) => !excludeIds?.has(id));
    if (ids.length !== 1) return false;
    const layer = layers.find((l) => l.id === ids[0]);
    return isLayerAspectLocked(layer);
}

export function SelectionTransformer({ selectedLayerIds, stageRef, excludeIds }: SelectionTransformerProps) {
    const trRef = useRef<Konva.Transformer>(null);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);
    const keepAspectRatio = useCanvasStore((s) =>
        selectionUsesTransformerKeepRatio(s.selectedLayerIds, s.layers, excludeIds),
    );
    // Re-attach only when the SELECTED layers' geometry/lock changes, not on
    // every unrelated layer edit in the document.
    const selectionSignature = useCanvasStore((s) => {
        let sig = "";
        for (const id of selectedLayerIds) {
            if (excludeIds?.has(id)) continue;
            const l = s.layers.find((x) => x.id === id);
            if (!l) continue;
            sig += `${id}:${l.x},${l.y},${l.width},${l.height},${l.rotation},${l.locked ? 1 : 0};`;
        }
        return sig;
    });

    useEffect(() => {
        if (!trRef.current || !stageRef.current) return;

        // Find all selected nodes, excluding frame children, locked layers, AND the currently editing text layer
        const layers = useCanvasStore.getState().layers;
        const filteredIds = selectedLayerIds.filter((id) => {
            if (excludeIds?.has(id)) return false;
            if (editingLayerId && id === editingLayerId) return false;
            const layer = layers.find((l) => l.id === id);
            if (layer?.locked) return false;
            return true;
        });
        if (filteredIds.length !== 1) {
            trRef.current.nodes([]);
            trRef.current.getLayer()?.batchDraw();
            return;
        }

        const nodes = filteredIds
            .map((id) => stageRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedLayerIds, stageRef, excludeIds, editingLayerId, selectionSignature]);

    return (
        <Transformer
            ref={trRef}
            keepRatio={keepAspectRatio}
            shiftBehavior="inverted"
            boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                if (keepAspectRatio) {
                    return applyAspectRatioToSideAnchor(oldBox, newBox, trRef.current?.getActiveAnchor());
                }
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
    const keepAspectRatio = useCanvasStore((s) =>
        selectionUsesTransformerKeepRatio(selectedChildIds, s.layers),
    );
    // Re-attach only when the selected children's geometry/lock changes.
    const selectionSignature = useCanvasStore((s) => {
        let sig = "";
        for (const id of selectedChildIds) {
            const l = s.layers.find((x) => x.id === id);
            if (!l) continue;
            sig += `${id}:${l.x},${l.y},${l.width},${l.height},${l.rotation},${l.locked ? 1 : 0};`;
        }
        return sig;
    });

    useEffect(() => {
        if (!trRef.current || !containerRef.current) return;

        // Exclude the currently editing text layer and locked layers from the transformer
        const layers = useCanvasStore.getState().layers;
        const filteredIds = selectedChildIds.filter((id) => {
            if (editingLayerId && id === editingLayerId) return false;
            const layer = layers.find((l) => l.id === id);
            if (layer?.locked) return false;
            return true;
        });

        const nodes = filteredIds
            .map((id) => containerRef.current?.findOne("#" + id))
            .filter((node): node is Konva.Node => !!node);

        trRef.current.nodes(nodes);
        trRef.current.getLayer()?.batchDraw();
    }, [selectedChildIds, containerRef, editingLayerId, selectionSignature]);

    const handleTransform = () => {
        const tr = trRef.current;
        if (!tr) return;
        const layers = useCanvasStore.getState().layers;
        const nodes = tr.nodes();
        nodes.forEach((node) => {
            const layer = layers.find(l => l.id === node.id());
            if (layer?.type === "text") {
                normalizeLiveTextTransform(node, layer);
            } else {
                enforceLockedAspectOnNode(node, layer);
            }
        });
    };

    return (
        <Transformer
            ref={trRef}
            onTransform={handleTransform}
            keepRatio={keepAspectRatio}
            shiftBehavior="inverted"
            boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                if (keepAspectRatio) {
                    return applyAspectRatioToSideAnchor(oldBox, newBox, trRef.current?.getActiveAnchor());
                }
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
