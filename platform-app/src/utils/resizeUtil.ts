import { DEFAULT_CONSTRAINTS, type BaseComponentProps } from "@/types";

export function applyConstraints(
    props: Pick<BaseComponentProps, "x" | "y" | "width" | "height" | "constraints">,
    masterDimensions: { width: number; height: number },
    targetDimensions: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
    const { x, y, width, height, constraints } = props;
    const { width: mw, height: mh } = masterDimensions;
    const { width: tw, height: th } = targetDimensions;

    const horizontal = constraints?.horizontal || DEFAULT_CONSTRAINTS.horizontal;
    const vertical = constraints?.vertical || DEFAULT_CONSTRAINTS.vertical;

    let nx = x;
    let nw = width;
    let ny = y;
    let nh = height;

    // Horizontal
    if (horizontal === "left") {
        nx = x;
    } else if (horizontal === "right") {
        const rightDist = mw - (x + width);
        nx = tw - rightDist - width;
    } else if (horizontal === "center") {
        const masterCenterX = mw / 2;
        const objectCenterX = x + width / 2;
        const offset = objectCenterX - masterCenterX;
        nx = (tw / 2) + offset - (width / 2);
    } else if (horizontal === "stretch") {
        const leftDist = x;
        const rightDist = mw - (x + width);
        nx = leftDist;
        nw = tw - leftDist - rightDist;
        if (nw < 10) nw = 10;
    } else if (horizontal === "scale") {
        nx = x * (tw / mw);
        nw = width * (tw / mw);
    }

    // Vertical
    if (vertical === "top") {
        ny = y;
    } else if (vertical === "bottom") {
        const bottomDist = mh - (y + height);
        ny = th - bottomDist - height;
    } else if (vertical === "center") {
        const masterCenterY = mh / 2;
        const objectCenterY = y + height / 2;
        const offset = objectCenterY - masterCenterY;
        ny = (th / 2) + offset - (height / 2);
    } else if (vertical === "stretch") {
        const topDist = y;
        const bottomDist = mh - (y + height);
        ny = topDist;
        nh = th - topDist - bottomDist;
        if (nh < 10) nh = 10;
    } else if (vertical === "scale") {
        ny = y * (th / mh);
        nh = height * (th / mh);
    }

    return { x: nx, y: ny, width: nw, height: nh };
}
