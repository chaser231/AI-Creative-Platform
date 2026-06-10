import type { FrameLayer } from "@/types";

export type ScreenHAlign = "left" | "center" | "right";
export type ScreenVAlign = "top" | "center" | "bottom";

type PrimaryAlign = NonNullable<FrameLayer["primaryAxisAlignItems"]>;
type CounterAlign = NonNullable<FrameLayer["counterAxisAlignItems"]>;

type AxisFlexAlign = "flex-start" | "center" | "flex-end";

const H_TO_FLEX: Record<ScreenHAlign, AxisFlexAlign> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
};

const V_TO_FLEX: Record<ScreenVAlign, AxisFlexAlign> = {
    top: "flex-start",
    center: "center",
    bottom: "flex-end",
};

const FLEX_TO_H: Record<AxisFlexAlign, ScreenHAlign> = {
    "flex-start": "left",
    center: "center",
    "flex-end": "right",
};

const FLEX_TO_V: Record<AxisFlexAlign, ScreenVAlign> = {
    "flex-start": "top",
    center: "center",
    "flex-end": "bottom",
};

/** Map a screen-space grid cell to stored primary/counter axis values. */
export function screenAlignToAutoLayoutAxes(
    layoutMode: "horizontal" | "vertical",
    h: ScreenHAlign,
    v: ScreenVAlign,
): { primaryAxisAlignItems: PrimaryAlign; counterAxisAlignItems: CounterAlign } {
    if (layoutMode === "horizontal") {
        return {
            primaryAxisAlignItems: H_TO_FLEX[h],
            counterAxisAlignItems: V_TO_FLEX[v],
        };
    }
    return {
        primaryAxisAlignItems: V_TO_FLEX[v],
        counterAxisAlignItems: H_TO_FLEX[h],
    };
}

/** Resolve which grid cell is active for the current axis values. */
export function autoLayoutAxesToScreenAlign(
    layoutMode: "horizontal" | "vertical",
    primary: PrimaryAlign,
    counter: CounterAlign,
): { h: ScreenHAlign; v: ScreenVAlign } | null {
    if (primary === "space-between") return null;

    if (counter === "stretch") return null;

    if (layoutMode === "horizontal") {
        return { h: FLEX_TO_H[primary], v: FLEX_TO_V[counter] };
    }
    return { h: FLEX_TO_H[counter], v: FLEX_TO_V[primary] };
}

/**
 * When auto-layout direction flips, swap primary/counter so the visual
 * alignment (top-left, bottom-right, …) stays on screen — same as Figma.
 */
export function swapAlignmentsForDirectionChange(
    primary: PrimaryAlign,
    counter: CounterAlign,
): { primaryAxisAlignItems: PrimaryAlign; counterAxisAlignItems: CounterAlign } {
    let newPrimary: PrimaryAlign = counter === "stretch" ? "flex-start" : counter;
    let newCounter: CounterAlign = primary === "space-between" ? "flex-start" : primary;

    return { primaryAxisAlignItems: newPrimary, counterAxisAlignItems: newCounter };
}
