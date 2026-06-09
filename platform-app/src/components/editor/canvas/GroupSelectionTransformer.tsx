"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Rect, Transformer } from "react-konva";
import Konva from "konva";
import { useCanvasStore } from "@/store/canvasStore";
import type { Layer } from "@/types";
import {
    applyBBoxToProxy,
    computeUnionBBox,
    distributeGroupTransform,
    proxyNodeToGroupBBox,
    type TransformableLayerSnap,
} from "@/utils/groupTransform";
import { applyAspectRatioToSideAnchor } from "@/utils/transformBox";
import { isLayerAspectLocked } from "@/utils/aspectRatioLock";
import { computeResizeSnap, type ActiveEdge, type SnapGuide } from "@/services/snapService";

export const MULTI_TRANSFORM_PROXY_ID = "__multi_transform_proxy__";

interface GroupSelectionTransformerProps {
    selectedLayerIds: string[];
    stageRef: React.RefObject<Konva.Stage | null>;
    excludeIds?: Set<string>;
    pauseProxySync?: boolean;
    canvasWidth: number;
    canvasHeight: number;
    onSnapGuides?: (guides: SnapGuide[]) => void;
    onTransformActiveChange?: (active: boolean) => void;
}

function activeEdgesFromAnchor(anchorName: string): ActiveEdge[] {
    const edges: ActiveEdge[] = [];
    if (anchorName.includes("top")) edges.push("top");
    if (anchorName.includes("bottom")) edges.push("bottom");
    if (anchorName.includes("left")) edges.push("left");
    if (anchorName.includes("right")) edges.push("right");
    if (anchorName === "middle-left") return ["left"];
    if (anchorName === "middle-right") return ["right"];
    if (anchorName === "top-center") return ["top"];
    if (anchorName === "bottom-center") return ["bottom"];
    return edges;
}

function filterSelectableIds(
    selectedLayerIds: string[],
    excludeIds: Set<string> | undefined,
    editingLayerId: string | null,
    layers: Layer[],
): string[] {
    return selectedLayerIds.filter((id) => {
        if (excludeIds?.has(id)) return false;
        if (editingLayerId && id === editingLayerId) return false;
        const layer = layers.find((l) => l.id === id);
        if (!layer || layer.locked) return false;
        return true;
    });
}

function layersToSnaps(ids: string[], layers: Layer[]): TransformableLayerSnap[] {
    const snaps: TransformableLayerSnap[] = [];
    for (const id of ids) {
        const l = layers.find((x) => x.id === id);
        if (!l) continue;
        snaps.push({
            id,
            x: l.x,
            y: l.y,
            width: l.width,
            height: l.height,
            rotation: l.rotation,
            lockAspectRatio: l.lockAspectRatio,
        });
    }
    return snaps;
}

export function GroupSelectionTransformer({
    selectedLayerIds,
    stageRef,
    excludeIds,
    pauseProxySync = false,
    canvasWidth,
    canvasHeight,
    onSnapGuides,
    onTransformActiveChange,
}: GroupSelectionTransformerProps) {
    const proxyRef = useRef<Konva.Rect>(null);
    const trRef = useRef<Konva.Transformer>(null);
    const snapshotRef = useRef<{ layers: TransformableLayerSnap[]; group: ReturnType<typeof computeUnionBBox> } | null>(null);
    const [transforming, setTransforming] = useState(false);
    const beginTransformPreview = useCanvasStore((s) => s.beginTransformPreview);
    const previewLayerGeometry = useCanvasStore((s) => s.previewLayerGeometry);
    const endTransformPreview = useCanvasStore((s) => s.endTransformPreview);
    const editingLayerId = useCanvasStore((s) => s.editingLayerId);
    const layers = useCanvasStore((s) => s.layers);

    const selectableIds = filterSelectableIds(selectedLayerIds, excludeIds, editingLayerId, layers);
    const snaps = layersToSnaps(selectableIds, layers);
    const unionBBox = computeUnionBBox(snaps);

    const selectionSignature = selectableIds.length >= 2
        ? snaps.map((s) => `${s.id}:${s.x},${s.y},${s.width},${s.height},${s.lockAspectRatio ? 1 : 0}`).join(";")
        : "";

    useEffect(() => {
        if (selectableIds.length < 2) return;
        const proxy = proxyRef.current;
        const tr = trRef.current;
        if (!proxy || !tr || transforming || pauseProxySync) return;

        applyBBoxToProxy(proxy, unionBBox);
        tr.nodes([proxy]);
        tr.getLayer()?.batchDraw();
    }, [unionBBox.x, unionBBox.y, unionBBox.width, unionBBox.height, selectableIds.length, selectionSignature, transforming, pauseProxySync]);

    const applyLive = useCallback(() => {
        const snap = snapshotRef.current;
        const proxy = proxyRef.current;
        const stage = stageRef.current;
        const tr = trRef.current;
        if (!snap || !proxy || !stage) return;

        let nextGroup = proxyNodeToGroupBBox(proxy);
        const { snapConfig, layers: allLayers } = useCanvasStore.getState();
        const selectedSet = new Set(snap.layers.map((l) => l.id));

        if ((snapConfig.objectSnap || snapConfig.artboardSnap) && tr) {
            const anchorName = tr.getActiveAnchor?.() || "";
            const activeEdges = activeEdgesFromAnchor(anchorName);
            if (activeEdges.length > 0) {
                const otherNodes = allLayers
                    .filter((l) => !selectedSet.has(l.id) && l.visible && !l.locked)
                    .map((l) => ({
                        id: l.id,
                        x: l.x,
                        y: l.y,
                        width: l.width,
                        height: l.height,
                        rotation: l.rotation,
                    }));
                const snapResult = computeResizeSnap(
                    {
                        id: MULTI_TRANSFORM_PROXY_ID,
                        x: nextGroup.x,
                        y: nextGroup.y,
                        width: nextGroup.width,
                        height: nextGroup.height,
                        rotation: 0,
                    },
                    otherNodes,
                    activeEdges,
                    snapConfig.artboardSnap ? { width: canvasWidth, height: canvasHeight } : undefined,
                );
                onSnapGuides?.(snapResult.guides);
                if (snapResult.guides.length > 0) {
                    applyBBoxToProxy(proxy, {
                        x: snapResult.x,
                        y: snapResult.y,
                        width: snapResult.width,
                        height: snapResult.height,
                    });
                    nextGroup = proxyNodeToGroupBBox(proxy);
                }
            }
        }

        const updates = distributeGroupTransform(snap.layers, snap.group, nextGroup);
        previewLayerGeometry(
            [...updates.entries()].map(([id, geom]) => ({ id, changes: geom })),
        );
        stage.batchDraw();
    }, [stageRef, canvasWidth, canvasHeight, onSnapGuides, previewLayerGeometry]);

    const handleTransformStart = useCallback(() => {
        const state = useCanvasStore.getState();
        const ids = filterSelectableIds(selectedLayerIds, excludeIds, state.editingLayerId, state.layers);
        const layerSnaps = layersToSnaps(ids, state.layers);
        if (layerSnaps.length < 2) return;

        const group = computeUnionBBox(layerSnaps);
        snapshotRef.current = { layers: layerSnaps, group };

        const proxy = proxyRef.current;
        if (proxy) {
            applyBBoxToProxy(proxy, group);
        }

        beginTransformPreview();
        setTransforming(true);
        onTransformActiveChange?.(true);
    }, [selectedLayerIds, excludeIds, onTransformActiveChange, beginTransformPreview]);

    const handleTransformEnd = useCallback(() => {
        const snap = snapshotRef.current;
        const proxy = proxyRef.current;
        if (!snap || !proxy) {
            endTransformPreview();
            setTransforming(false);
            onTransformActiveChange?.(false);
            return;
        }

        const nextGroup = proxyNodeToGroupBBox(proxy);
        const updates = distributeGroupTransform(snap.layers, snap.group, nextGroup);
        previewLayerGeometry(
            [...updates.entries()].map(([id, geom]) => ({ id, changes: geom })),
        );
        applyBBoxToProxy(proxy, nextGroup);

        snapshotRef.current = null;
        endTransformPreview();
        setTransforming(false);
        onTransformActiveChange?.(false);
        trRef.current?.getLayer()?.batchDraw();
    }, [previewLayerGeometry, endTransformPreview, onTransformActiveChange]);

    const allLocked = selectableIds.length > 0
        && selectableIds.every((id) => isLayerAspectLocked(layers.find((l) => l.id === id)));

    if (selectableIds.length < 2) return null;

    return (
        <>
            <Rect
                ref={proxyRef}
                id={MULTI_TRANSFORM_PROXY_ID}
                fill="rgba(0,0,0,0.001)"
                listening={false}
            />
            <Transformer
                ref={trRef}
                keepRatio={allLocked}
                shiftBehavior="inverted"
                rotateEnabled={false}
                onTransformStart={handleTransformStart}
                onTransform={applyLive}
                onTransformEnd={handleTransformEnd}
                boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 5 || newBox.height < 5) return oldBox;
                    if (allLocked) {
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
        </>
    );
}
