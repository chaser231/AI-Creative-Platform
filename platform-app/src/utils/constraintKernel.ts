import { DEFAULT_CONSTRAINTS, type LayerConstraints } from "@/types";

export interface ConstraintBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ParentBoundsDelta {
    oldX: number;
    oldY: number;
    oldWidth: number;
    oldHeight: number;
    newX: number;
    newY: number;
    newWidth: number;
    newHeight: number;
}

/**
 * Single source of truth for constraint box math when a parent resizes.
 * Given a child's absolute position/size and the parent's old & new bounds,
 * returns the child's new absolute position/size that honours its constraints.
 */
export function applyConstraintBox(
    child: ConstraintBounds & { constraints?: LayerConstraints },
    delta: ParentBoundsDelta,
): ConstraintBounds {
    const c = child.constraints ?? DEFAULT_CONSTRAINTS;
    const { oldX, oldY, oldWidth, oldHeight, newX, newY, newWidth, newHeight } = delta;

    // Degenerate parent bounds would produce NaN/Infinity in center/scale
    // branches (division by zero). Fall back to a "fixed" translation:
    // keep the child in place relative to the new parent origin.
    if (!(oldWidth > 0) || !(oldHeight > 0)) {
        return {
            x: newX + (child.x - oldX),
            y: newY + (child.y - oldY),
            width: Math.max(1, child.width),
            height: Math.max(1, child.height),
        };
    }

    const relX = child.x - oldX;
    const relY = child.y - oldY;
    const rightGap = oldWidth - (relX + child.width);
    const bottomGap = oldHeight - (relY + child.height);

    let outX = child.x;
    let outY = child.y;
    let outW = child.width;
    let outH = child.height;

    // ── HORIZONTAL ──
    switch (c.horizontal) {
        case "left":
            outX = newX + relX;
            break;
        case "right":
            outX = newX + newWidth - rightGap - child.width;
            break;
        case "center": {
            const centerRatio = (relX + child.width / 2) / oldWidth;
            outX = newX + centerRatio * newWidth - child.width / 2;
            break;
        }
        case "stretch":
            outX = newX + relX;
            outW = newWidth - relX - rightGap;
            break;
        case "scale": {
            const sx = newWidth / oldWidth;
            outX = newX + relX * sx;
            outW = child.width * sx;
            break;
        }
    }

    // ── VERTICAL ──
    switch (c.vertical) {
        case "top":
            outY = newY + relY;
            break;
        case "bottom":
            outY = newY + newHeight - bottomGap - child.height;
            break;
        case "center": {
            const centerRatio = (relY + child.height / 2) / oldHeight;
            outY = newY + centerRatio * newHeight - child.height / 2;
            break;
        }
        case "stretch":
            outY = newY + relY;
            outH = newHeight - relY - bottomGap;
            break;
        case "scale": {
            const sy = newHeight / oldHeight;
            outY = newY + relY * sy;
            outH = child.height * sy;
            break;
        }
    }

    return { x: outX, y: outY, width: Math.max(1, outW), height: Math.max(1, outH) };
}
