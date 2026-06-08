/**
 * Constraint inference for layout adaptation.
 *
 * When a layer has no explicit `constraints`, we infer Figma-like resize
 * constraints from its geometry relative to its parent (the artboard for root
 * layers, or the containing frame for children). This makes the DEFAULT
 * adaptation behave sensibly (edge-pinned stays pinned, centered stays
 * centered, full-span stretches) instead of clinging to the top-left corner.
 *
 * Inference is only ever a fallback: an explicit `layer.constraints` always
 * wins (see `resolveConstraints`).
 */

import type { ConstraintH, ConstraintV, Layer, LayerConstraints } from "@/types";

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Tunables — fractions of the parent axis length.
const STRETCH_FRACTION = 0.9; // layer spans >= 90% of the parent axis
const CENTER_TOLERANCE = 0.08; // centered if center offset within 8% of the axis
const GAP_SYMMETRY = 0.2; // start/end gaps treated as symmetric if they differ < 20%

type AxisAnchor = "start" | "end" | "center" | "stretch" | "scale";

function inferAxis(
    childStart: number,
    childSize: number,
    parentStart: number,
    parentSize: number,
    allowStretch: boolean,
): AxisAnchor {
    if (!(parentSize > 0)) return "start";

    const startGap = childStart - parentStart;
    const endGap = (parentStart + parentSize) - (childStart + childSize);
    const sizeFrac = childSize / parentSize;
    const gapDiff = Math.abs(startGap - endGap) / parentSize;

    // Spans almost the whole axis with roughly symmetric margins → fill it.
    if (sizeFrac >= STRETCH_FRACTION && gapDiff <= GAP_SYMMETRY) {
        return allowStretch ? "stretch" : "scale";
    }

    // Roughly centered with symmetric margins → keep centered.
    const childCenter = childStart + childSize / 2;
    const parentCenter = parentStart + parentSize / 2;
    const centerOffset = Math.abs(childCenter - parentCenter) / parentSize;
    if (centerOffset <= CENTER_TOLERANCE && gapDiff <= GAP_SYMMETRY) {
        return "center";
    }

    // Otherwise pin to whichever edge the layer sits closest to.
    return endGap < startGap ? "end" : "start";
}

const H_ANCHOR: Record<AxisAnchor, ConstraintH> = {
    start: "left",
    end: "right",
    center: "center",
    stretch: "stretch",
    scale: "scale",
};

const V_ANCHOR: Record<AxisAnchor, ConstraintV> = {
    start: "top",
    end: "bottom",
    center: "center",
    stretch: "stretch",
    scale: "scale",
};

export function inferConstraints(child: Box, parent: Box, type: Layer["type"]): LayerConstraints {
    // Solid boxes can safely stretch; text/image/badge scale instead so their
    // intrinsic content isn't distorted by an independent per-axis stretch.
    const allowStretch = type === "rectangle" || type === "frame";
    return {
        horizontal: H_ANCHOR[inferAxis(child.x, child.width, parent.x, parent.width, allowStretch)],
        vertical: V_ANCHOR[inferAxis(child.y, child.height, parent.y, parent.height, allowStretch)],
    };
}

/**
 * Returns the layer's explicit constraints, or inferred ones when unset.
 * `parent` is the reference box (artboard for roots, frame for children) in the
 * SAME coordinate space as the layer.
 */
export function resolveConstraints(
    layer: Pick<Layer, "x" | "y" | "width" | "height" | "type" | "constraints">,
    parent: Box,
): LayerConstraints {
    return layer.constraints ?? inferConstraints(layer, parent, layer.type);
}
