import type { BaseComponentProps } from "@/types";
import { applyConstraintBox } from "@/utils/constraintKernel";

export function applyConstraints(
    props: Pick<BaseComponentProps, "x" | "y" | "width" | "height" | "constraints">,
    masterDimensions: { width: number; height: number },
    targetDimensions: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
    const { width: mw, height: mh } = masterDimensions;
    const { width: tw, height: th } = targetDimensions;

    return applyConstraintBox(props, {
        oldX: 0,
        oldY: 0,
        oldWidth: mw,
        oldHeight: mh,
        newX: 0,
        newY: 0,
        newWidth: tw,
        newHeight: th,
    });
}
