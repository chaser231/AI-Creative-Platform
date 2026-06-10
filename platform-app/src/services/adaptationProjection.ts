import {
    DEFAULT_CONSTRAINTS,
    type FrameLayer,
    type Layer,
    type LayerConstraints,
    type VectorLayer,
} from "@/types";
import { computeConstrainedPosition } from "@/store/canvas/helpers";
import { resolveConstraints, type Box } from "@/utils/constraintInference";
export interface ArtboardSize {
    width: number;
    height: number;
}

/**
 * Projects an ENTIRE layer tree from a source artboard to a target artboard.
 *
 * Root layers are projected against the artboard (honouring background/fluid/
 * fixed behaviours, otherwise explicit-or-inferred constraints). Children of
 * NON-auto-layout frames are then projected recursively against their parent
 * frame's old→new box, so nested content adapts instead of clinging to the
 * top-left. Auto-layout frames keep their children untouched here — they are
 * repacked afterwards by `applyAllAutoLayouts`.
 */
export function projectTree(
    layers: Layer[],
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
    options: { scaleFonts?: boolean; scaleVectors?: boolean } = {},
): Layer[] {
    const scaleFonts = options.scaleFonts ?? true;
    const scaleVectors = options.scaleVectors ?? true;
    const sizeUnchanged =
        Math.abs(sourceSize.width - targetSize.width) < 0.01 &&
        Math.abs(sourceSize.height - targetSize.height) < 0.01;
    if (sizeUnchanged) return layers;

    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const childIdSet = new Set<string>();
    for (const layer of layers) {
        if (layer.type === "frame") {
            for (const childId of (layer as FrameLayer).childIds) childIdSet.add(childId);
        }
        const parentId = (layer as Layer & { parentId?: string }).parentId;
        if (parentId) childIdSet.add(layer.id);
    }

    const newGeom = new Map<string, Pick<Layer, "x" | "y" | "width" | "height">>();

    for (const layer of layers) {
        if (childIdSet.has(layer.id)) continue;
        newGeom.set(layer.id, projectRootRect(layer, sourceSize, targetSize));
    }

    const projectChildren = (frameId: string, oldBox: Box, newBox: Box) => {
        const frame = byId.get(frameId);
        if (!frame || frame.type !== "frame") return;
        if (frame.layoutMode && frame.layoutMode !== "none") return;

        const delta = {
            oldX: oldBox.x, oldY: oldBox.y, oldWidth: oldBox.width, oldHeight: oldBox.height,
            newX: newBox.x, newY: newBox.y, newWidth: newBox.width, newHeight: newBox.height,
        };

        for (const childId of (frame as FrameLayer).childIds) {
            const child = byId.get(childId);
            if (!child) continue;
            const childOld: Box = { x: child.x, y: child.y, width: child.width, height: child.height };
            const constraints = adaptationConstraints(child, oldBox);
            const projected = computeConstrainedPosition({ ...childOld, constraints }, delta);
            newGeom.set(childId, projected);
            if (child.type === "frame") {
                projectChildren(childId, childOld, projected);
            }
        }
    };

    for (const layer of layers) {
        if (childIdSet.has(layer.id) || layer.type !== "frame") continue;
        const oldBox: Box = { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
        const ng = newGeom.get(layer.id);
        if (!ng) continue;
        projectChildren(layer.id, oldBox, { x: ng.x, y: ng.y, width: ng.width, height: ng.height });
    }

    const fontScale = getScale(sourceSize, targetSize).font;
    const padScaleX = targetSize.width / Math.max(1, sourceSize.width);
    const padScaleY = targetSize.height / Math.max(1, sourceSize.height);
    const padOverrides = new Map<string, Partial<FrameLayer>>();
    for (const layer of layers) {
        if (layer.type !== "frame") continue;
        const frame = layer as FrameLayer;
        if (!frame.layoutMode || frame.layoutMode === "none") continue;
        const horizontal = frame.layoutMode === "horizontal";
        const o: Partial<FrameLayer> = {};
        if (typeof frame.paddingLeft === "number") o.paddingLeft = round2(frame.paddingLeft * padScaleX);
        if (typeof frame.paddingRight === "number") o.paddingRight = round2(frame.paddingRight * padScaleX);
        if (typeof frame.paddingTop === "number") o.paddingTop = round2(frame.paddingTop * padScaleY);
        if (typeof frame.paddingBottom === "number") o.paddingBottom = round2(frame.paddingBottom * padScaleY);
        if (typeof frame.spacing === "number") o.spacing = round2(frame.spacing * (horizontal ? padScaleX : padScaleY));
        padOverrides.set(layer.id, o);
    }

    return layers.map((layer) => {
        const geom = newGeom.get(layer.id);
        const pad = padOverrides.get(layer.id);
        let next = (geom || pad) ? ({ ...layer, ...geom, ...pad } as Layer) : layer;
        if (scaleFonts) next = scaleFontIfNeeded(next, layer, fontScale);
        if (scaleVectors) next = scaleVectorIfNeeded(next, layer, fontScale);
        return next;
    });
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function adaptationConstraints(
    layer: Layer,
    parent: Box,
): LayerConstraints {
    const base = resolveConstraints(layer, parent);
    if (layer.type !== "frame") return base;
    const frame = layer as FrameLayer;
    if (!frame.layoutMode || frame.layoutMode === "none") return base;
    return {
        horizontal: frame.layoutSizingWidth === "fill"
            ? "stretch"
            : frame.layoutSizingWidth === "hug"
                ? "scale"
                : base.horizontal,
        vertical: frame.layoutSizingHeight === "fill"
            ? "stretch"
            : frame.layoutSizingHeight === "hug"
                ? "scale"
                : base.vertical,
    };
}

function getScale(sourceSize: ArtboardSize, targetSize: ArtboardSize) {
    const scaleX = targetSize.width / Math.max(1, sourceSize.width);
    const scaleY = targetSize.height / Math.max(1, sourceSize.height);
    return {
        x: scaleX,
        y: scaleY,
        font: Math.sqrt(scaleX * scaleY),
    };
}

function projectRootRect(
    layer: Layer,
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
): Pick<Layer, "x" | "y" | "width" | "height"> {
    const behavior = layer.responsive?.behavior ?? "auto";
    const scale = getScale(sourceSize, targetSize);

    if (behavior === "background") {
        return { x: 0, y: 0, width: targetSize.width, height: targetSize.height };
    }

    if (behavior === "fluid") {
        return {
            x: layer.x * scale.x,
            y: layer.y * scale.y,
            width: layer.width * scale.x,
            height: layer.height * scale.y,
        };
    }

    if (behavior === "fixed") {
        return computeFixedPosition(layer, sourceSize, targetSize);
    }

    const artboardOld: Box = { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
    const constraints = adaptationConstraints(layer, artboardOld);
    return computeConstrainedPosition(
        { x: layer.x, y: layer.y, width: layer.width, height: layer.height, constraints },
        {
            oldX: 0,
            oldY: 0,
            oldWidth: sourceSize.width,
            oldHeight: sourceSize.height,
            newX: 0,
            newY: 0,
            newWidth: targetSize.width,
            newHeight: targetSize.height,
        },
    );
}

function computeFixedPosition(
    layer: Pick<Layer, "x" | "y" | "width" | "height" | "constraints">,
    sourceSize: ArtboardSize,
    targetSize: ArtboardSize,
): Pick<Layer, "x" | "y" | "width" | "height"> {
    const constraints = layer.constraints ?? DEFAULT_CONSTRAINTS;
    return {
        x: computeFixedAxis(
            layer.x,
            layer.width,
            sourceSize.width,
            targetSize.width,
            constraints.horizontal,
        ),
        y: computeFixedAxis(
            layer.y,
            layer.height,
            sourceSize.height,
            targetSize.height,
            constraints.vertical,
        ),
        width: layer.width,
        height: layer.height,
    };
}

function computeFixedAxis(
    start: number,
    size: number,
    sourceAxis: number,
    targetAxis: number,
    constraint: LayerConstraints["horizontal"] | LayerConstraints["vertical"],
): number {
    if (constraint === "right" || constraint === "bottom") {
        const endGap = sourceAxis - (start + size);
        return targetAxis - endGap - size;
    }
    if (constraint === "center") {
        const centerRatio = (start + size / 2) / Math.max(1, sourceAxis);
        return centerRatio * targetAxis - size / 2;
    }
    if (constraint === "scale") {
        return start * (targetAxis / Math.max(1, sourceAxis));
    }
    return start;
}

function scaleFontIfNeeded(layer: Layer, base: Layer, fontScale: number): Layer {
    if (layer.responsive?.behavior === "fixed") return layer;

    if (layer.type !== "text" && layer.type !== "badge") return layer;
    const baseFontSize = base.type === layer.type && "fontSize" in base
        ? base.fontSize
        : layer.fontSize;
    const minFontSize = layer.responsive?.minFontSize ?? 8;
    const maxFontSize = layer.responsive?.maxFontSize;
    const nextFontSize = clamp(
        baseFontSize * fontScale,
        minFontSize,
        maxFontSize,
    );

    if (Math.abs(nextFontSize - layer.fontSize) < 0.01) return layer;
    return { ...layer, fontSize: Math.round(nextFontSize * 100) / 100 } as Layer;
}

/**
 * Vectors ("сложные векторы") carry no intrinsic font size, so constraint
 * projection alone keeps a corner-pinned / centred logo at its original pixel
 * size — it only moves. To make complex vectors adapt like the rest of the
 * composition, scale their box UNIFORMLY by the same factor used for fonts
 * (`sqrt(scaleX * scaleY)`), preserving aspect ratio, and keep the
 * constraint-projected centre fixed so positioning still honours the layer's
 * anchoring. Explicit `fixed` / `fluid` / `background` behaviours opt out
 * (their sizing is already resolved in `projectRootRect`).
 */
function scaleVectorIfNeeded(layer: Layer, base: Layer, uniformScale: number): Layer {
    if (layer.type !== "vector") return layer;
    if ((layer.responsive?.behavior ?? "auto") !== "auto") return layer;
    if (!(uniformScale > 0) || Math.abs(uniformScale - 1) < 1e-3) return layer;

    const baseWidth = base.type === "vector" ? base.width : layer.width;
    const baseHeight = base.type === "vector" ? base.height : layer.height;
    const nextWidth = round2(baseWidth * uniformScale);
    const nextHeight = round2(baseHeight * uniformScale);
    if (!(nextWidth > 0) || !(nextHeight > 0)) return layer;

    const centerX = layer.x + layer.width / 2;
    const centerY = layer.y + layer.height / 2;
    const vector = layer as VectorLayer;
    const patch: Partial<VectorLayer> = {
        width: nextWidth,
        height: nextHeight,
        x: round2(centerX - nextWidth / 2),
        y: round2(centerY - nextHeight / 2),
    };
    if (typeof vector.strokeWidth === "number" && vector.strokeWidth > 0) {
        patch.strokeWidth = round2(vector.strokeWidth * uniformScale);
    }
    return { ...layer, ...patch } as Layer;
}

function clamp(value: number, min: number, max: number | undefined): number {
    const lower = Math.max(min, value);
    return typeof max === "number" && Number.isFinite(max)
        ? Math.min(max, lower)
        : lower;
}
