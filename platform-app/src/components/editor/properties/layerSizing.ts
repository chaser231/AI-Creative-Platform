import type { Layer } from "@/types";

/**
 * Pure sizing-mode helpers shared by the inspector's `SizeField` numbers and the
 * `SizeModeRow` SegmentedControl. Kept free of React/store imports so the
 * fixed/fill/hug option set and the update resolution can be unit-tested in
 * isolation — and so the SegmentedControl and the (legacy) dropdown resolve to
 * the exact same `toUpdates` path.
 */

export type SizeModeOption = { value: string; label: string };

export type LayerSizeModeConfig = {
    value: string;
    options: SizeModeOption[];
    toUpdates: (value: string) => Partial<Layer>;
};

export function layoutSizingOptions(layer: Layer): SizeModeOption[] {
    return [
        { value: "fixed", label: "Fixed" },
        { value: "fill", label: "Fill" },
        ...(layer.type === "frame" || layer.type === "text" ? [{ value: "hug", label: "Hug" }] : []),
    ];
}

export function getLayerSizeModeConfig(
    layer: Layer,
    axis: "width" | "height",
    isInsideAutoLayout: boolean,
): LayerSizeModeConfig | undefined {
    if (isInsideAutoLayout) {
        return {
            value: axis === "width" ? layer.layoutSizingWidth || "fixed" : layer.layoutSizingHeight || "fixed",
            options: layoutSizingOptions(layer),
            toUpdates: (value) => resolveLayoutSizingUpdate(layer, axis, value),
        };
    }

    if (layer.type !== "frame" || !layer.layoutMode || layer.layoutMode === "none") {
        return undefined;
    }

    const axisUsesPrimarySizing = axis === "width"
        ? layer.layoutMode === "horizontal"
        : layer.layoutMode === "vertical";
    const mode = axisUsesPrimarySizing ? layer.primaryAxisSizingMode : layer.counterAxisSizingMode;

    return {
        value: mode === "auto" ? "hug" : "fixed",
        options: [
            { value: "fixed", label: "Fixed" },
            { value: "hug", label: "Hug" },
        ],
        toUpdates: (value) => (axisUsesPrimarySizing
            ? { primaryAxisSizingMode: value === "hug" ? "auto" : "fixed" }
            : { counterAxisSizingMode: value === "hug" ? "auto" : "fixed" }) as Partial<Layer>,
    };
}

export function resolveManualSizeUpdate(
    layer: Layer,
    axis: "width" | "height",
    value: number,
    modeConfig?: LayerSizeModeConfig,
): Partial<Layer> {
    const updates: Partial<Layer> = axis === "width" ? { width: value } : { height: value };

    // Text: write raw intent only. `normalizeTextLayer` (in the store's
    // updateLayer) pins the edited axis to fixed and re-derives textAdjust /
    // layoutSizing so the two sizing models never drift apart.
    if (layer.type === "text") {
        return updates;
    }

    if (modeConfig && modeConfig.value !== "fixed") {
        Object.assign(updates, modeConfig.toUpdates("fixed"));
    }

    return updates;
}

export function resolveLayoutSizingUpdate(layer: Layer, axis: "width" | "height", value: string): Partial<Layer> {
    // Raw intent for both text and non-text. For text, `normalizeTextLayer`
    // derives the matching textAdjust from this layout-sizing pair; the UI no
    // longer second-guesses it here (no hidden textAdjust syncs).
    return axis === "width"
        ? { layoutSizingWidth: value as Layer["layoutSizingWidth"] }
        : { layoutSizingHeight: value as Layer["layoutSizingHeight"] };
}
