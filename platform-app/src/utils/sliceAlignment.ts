/**
 * Slice-aware layer alignment — a third automation pass, independent of
 * auto-layout and format adaptation. Runs AFTER `applyAllAutoLayouts` and
 * re-positions / re-scales layers flagged with `sliceAlign` so they are not
 * clipped by slice cut-lines.
 *
 * Two modes (see `SliceAlignMode`):
 *  - `avoid_cut`: minimal shift so the TARGET layer fits fully inside one cell.
 *  - `fit`:       proportionally scale the MOVER to its nearest cell + center.
 *
 * Two scopes (see `SliceAlignScope`):
 *  - `frame`: the layer's outermost (top-level) frame moves/scales as a whole,
 *             keeping inner layout intact (shift the whole subtree by one delta).
 *  - `layer`: the layer is detached (`isAbsolutePositioned`) and moved/scaled
 *             on its own so a later auto-layout pass cannot snap it back.
 *
 * Orientation (X / Y / both) is derived from the slice geometry, not stored.
 */

import type { FrameLayer, Layer } from "@/types";
import { applyAllAutoLayouts } from "@/utils/layoutEngine";
import {
    computeAvoidCutDelta,
    computeFitTransform,
    deriveSliceGrid,
    findContainingCell,
    findNearestCell,
    type Axes,
    type Rect,
    type SliceGrid,
} from "@/utils/sliceLayout";

export interface SliceAlignDiagnostic {
    layerId: string;
    layerName: string;
    code: "cannot-avoid-cut";
    message: string;
}

export interface SliceAlignmentResult {
    layers: Layer[];
    diagnostics: SliceAlignDiagnostic[];
}

const EPSILON = 0.01;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function boxOf(layer: Pick<Layer, "x" | "y" | "width" | "height">): Rect {
    return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
}

function scaleMaybe(value: number | undefined, scale: number): number | undefined {
    return typeof value === "number" ? round2(value * scale) : value;
}

function buildChildToParent(layers: Layer[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const layer of layers) {
        if (layer.type === "frame") {
            for (const childId of (layer as FrameLayer).childIds) map.set(childId, layer.id);
        }
    }
    return map;
}

function topLevelAncestorId(id: string, childToParent: Map<string, string>): string {
    let cur = id;
    const seen = new Set<string>();
    while (childToParent.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = childToParent.get(cur) as string;
    }
    return cur;
}

function collectDescendantIds(frameId: string, byId: Map<string, Layer>): string[] {
    const out: string[] = [];
    const root = byId.get(frameId);
    if (!root || root.type !== "frame") return out;
    const stack = [...(root as FrameLayer).childIds];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        out.push(id);
        const layer = byId.get(id);
        if (layer?.type === "frame") stack.push(...(layer as FrameLayer).childIds);
    }
    return out;
}

/** Translate a layer by (dx, dy), rounding the result. */
function translateLayer(layer: Layer, dx: number, dy: number): Layer {
    return { ...layer, x: round2(layer.x + dx), y: round2(layer.y + dy) } as Layer;
}

/** Uniformly scale a single layer's geometry and style around the given top-left. */
function scaleLayer(base: Layer, scale: number, newX: number, newY: number): Layer {
    const geom = {
        x: round2(newX),
        y: round2(newY),
        width: round2(base.width * scale),
        height: round2(base.height * scale),
    };
    switch (base.type) {
        case "text":
            return {
                ...base,
                ...geom,
                fontSize: round2(base.fontSize * scale),
                letterSpacing: round2(base.letterSpacing * scale),
            };
        case "badge":
            return { ...base, ...geom, fontSize: round2(base.fontSize * scale) };
        case "frame":
            return {
                ...base,
                ...geom,
                paddingTop: scaleMaybe(base.paddingTop, scale),
                paddingRight: scaleMaybe(base.paddingRight, scale),
                paddingBottom: scaleMaybe(base.paddingBottom, scale),
                paddingLeft: scaleMaybe(base.paddingLeft, scale),
                spacing: scaleMaybe(base.spacing, scale),
                strokeWidth: typeof base.strokeWidth === "number" ? round2(base.strokeWidth * scale) : base.strokeWidth,
                cornerRadius: typeof base.cornerRadius === "number" ? round2(base.cornerRadius * scale) : base.cornerRadius,
            };
        case "rectangle":
            return {
                ...base,
                ...geom,
                strokeWidth: typeof base.strokeWidth === "number" ? round2(base.strokeWidth * scale) : base.strokeWidth,
                cornerRadius: typeof base.cornerRadius === "number" ? round2(base.cornerRadius * scale) : base.cornerRadius,
            };
        case "image":
            return {
                ...base,
                ...geom,
                strokeWidth: typeof base.strokeWidth === "number" ? round2(base.strokeWidth * scale) : base.strokeWidth,
                cornerRadius: typeof base.cornerRadius === "number" ? round2(base.cornerRadius * scale) : base.cornerRadius,
            };
        default:
            return { ...base, ...geom } as Layer;
    }
}

/** Shift a frame and its whole subtree by (dx, dy). */
function shiftSubtree(byId: Map<string, Layer>, frameId: string, dx: number, dy: number): void {
    const frame = byId.get(frameId);
    if (!frame) return;
    const descendants = collectDescendantIds(frameId, byId);
    byId.set(frameId, translateLayer(frame, dx, dy));
    for (const id of descendants) {
        const layer = byId.get(id);
        if (layer) byId.set(id, translateLayer(layer, dx, dy));
    }
}

/** Uniformly scale a frame and its whole subtree to a new origin. */
function scaleSubtree(byId: Map<string, Layer>, frameId: string, scale: number, newX: number, newY: number): void {
    const frame = byId.get(frameId);
    if (!frame || frame.type !== "frame") return;
    const oldX = frame.x;
    const oldY = frame.y;
    const descendants = collectDescendantIds(frameId, byId);
    byId.set(frameId, scaleLayer(frame, scale, newX, newY));
    for (const id of descendants) {
        const layer = byId.get(id);
        if (!layer) continue;
        const childX = newX + (layer.x - oldX) * scale;
        const childY = newY + (layer.y - oldY) * scale;
        byId.set(id, scaleLayer(layer, scale, childX, childY));
    }
}

function hasActiveAxis(grid: SliceGrid): boolean {
    return grid.axisX || grid.axisY;
}

/**
 * Apply slice-aware alignment to all flagged layers. Pure: returns a new array
 * plus diagnostics. No-op (returns the input array) when there are no slices,
 * no active cut-lines, or no flagged layers.
 */
export function applySliceAlignment(layers: Layer[]): SliceAlignmentResult {
    const diagnostics: SliceAlignDiagnostic[] = [];

    const slices = layers.filter((l) => l.type === "slice");
    if (slices.length === 0) return { layers, diagnostics };

    const grid = deriveSliceGrid(slices.map(boxOf));
    if (!hasActiveAxis(grid)) return { layers, diagnostics };
    const axes: Axes = { x: grid.axisX, y: grid.axisY };

    const targets = layers.filter(
        (l) => l.type !== "slice" && l.sliceAlign != null && l.sliceAlign.mode !== "none",
    );
    if (targets.length === 0) return { layers, diagnostics };

    const byId = new Map<string, Layer>(layers.map((l) => [l.id, { ...l } as Layer]));
    const childToParent = buildChildToParent(layers);
    let needsRelayout = false;

    const detachIfNested = (id: string) => {
        if (!childToParent.has(id)) return;
        const layer = byId.get(id);
        if (!layer) return;
        if (!layer.isAbsolutePositioned) {
            byId.set(id, { ...layer, isAbsolutePositioned: true } as Layer);
            needsRelayout = true;
        }
    };

    for (const target of targets) {
        const settings = target.sliceAlign;
        if (!settings) continue;
        const moverId = settings.scope === "frame"
            ? topLevelAncestorId(target.id, childToParent)
            : target.id;
        const mover = byId.get(moverId);
        if (!mover) continue;

        if (settings.mode === "avoid_cut") {
            // Subject = the TARGET box: that is what must stay uncut.
            const targetNow = byId.get(target.id);
            if (!targetNow) continue;
            const subject = boxOf(targetNow);
            const cell = findContainingCell(subject, grid.cells, axes);
            if (!cell) {
                diagnostics.push({
                    layerId: target.id,
                    layerName: target.name,
                    code: "cannot-avoid-cut",
                    message: `Слой «${target.name}» больше слайса по активной оси — сдвиг невозможен.`,
                });
                continue;
            }
            const { dx, dy } = computeAvoidCutDelta(subject, cell, axes);
            if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) continue;

            if (mover.type === "frame") {
                shiftSubtree(byId, moverId, dx, dy);
                if (settings.scope === "layer") detachIfNested(moverId);
            } else {
                byId.set(moverId, translateLayer(mover, dx, dy));
                if (settings.scope === "layer") detachIfNested(moverId);
            }
        } else if (settings.mode === "fit") {
            // Subject = the MOVER box: that is what we resize to a cell.
            const moverNow = byId.get(moverId);
            if (!moverNow) continue;
            const subject = boxOf(moverNow);
            const cell = findNearestCell(subject, grid.cells);
            if (!cell) continue;
            const { scale, x, y } = computeFitTransform(subject, cell, axes);
            if (!(scale > 0)) continue;

            if (moverNow.type === "frame") {
                scaleSubtree(byId, moverId, scale, x, y);
                needsRelayout = true;
                if (settings.scope === "layer") detachIfNested(moverId);
            } else {
                byId.set(moverId, scaleLayer(moverNow, scale, x, y));
                if (settings.scope === "layer") detachIfNested(moverId);
            }
        }
    }

    let result = layers.map((l) => byId.get(l.id) ?? l);
    if (needsRelayout) result = applyAllAutoLayouts(result);
    return { layers: result, diagnostics };
}

/**
 * Lightweight, read-only evaluation for the inspector UI: does an active slice
 * grid exist, and is `avoid_cut` feasible for this layer (a cell can contain
 * it)? Uses the layer's current box.
 */
export function describeSliceAlignment(
    layer: Layer,
    layers: Layer[],
): { hasGrid: boolean; axes: Axes; avoidCutFeasible: boolean } {
    const slices = layers.filter((l) => l.type === "slice");
    if (slices.length === 0) {
        return { hasGrid: false, axes: { x: false, y: false }, avoidCutFeasible: true };
    }
    const grid = deriveSliceGrid(slices.map(boxOf));
    const axes: Axes = { x: grid.axisX, y: grid.axisY };
    if (!hasActiveAxis(grid)) {
        return { hasGrid: false, axes, avoidCutFeasible: true };
    }
    const cell = findContainingCell(boxOf(layer), grid.cells, axes);
    return { hasGrid: true, axes, avoidCutFeasible: cell != null };
}
