type Box = { x: number; y: number; width: number; height: number; rotation: number };

/**
 * Konva's `keepRatio` only constrains corner anchors. Side anchors scale
 * proportionally with the opposite edge midpoint fixed.
 */
export function applyAspectRatioToSideAnchor(oldBox: Box, newBox: Box, anchor: string | null | undefined): Box {
    if (!anchor || oldBox.height === 0 || oldBox.width === 0) return newBox;
    const isHorizontal = anchor === "middle-left" || anchor === "middle-right";
    const isVertical = anchor === "top-center" || anchor === "bottom-center";
    if (!isHorizontal && !isVertical) return newBox;

    const ratio = oldBox.width / oldBox.height;
    const rad = (newBox.rotation * Math.PI) / 180;
    const xAxis = { x: Math.cos(rad), y: Math.sin(rad) };
    const yAxis = { x: -Math.sin(rad), y: Math.cos(rad) };

    let newW: number;
    let newH: number;
    if (isHorizontal) {
        newW = newBox.width;
        newH = newW / ratio;
    } else {
        newH = newBox.height;
        newW = newH * ratio;
    }

    const op0 = { x: oldBox.x, y: oldBox.y };
    const edgeMid = (ax: number, ay: number) => ({
        x: op0.x + ax * xAxis.x + ay * yAxis.x,
        y: op0.y + ax * xAxis.y + ay * yAxis.y,
    });

    let fixed: { x: number; y: number };
    let newP0: { x: number; y: number };
    if (anchor === "middle-right") {
        fixed = edgeMid(0, oldBox.height / 2);
        newP0 = { x: fixed.x - (newH / 2) * yAxis.x, y: fixed.y - (newH / 2) * yAxis.y };
    } else if (anchor === "middle-left") {
        fixed = edgeMid(oldBox.width, oldBox.height / 2);
        newP0 = {
            x: fixed.x - newW * xAxis.x - (newH / 2) * yAxis.x,
            y: fixed.y - newW * xAxis.y - (newH / 2) * yAxis.y,
        };
    } else if (anchor === "bottom-center") {
        fixed = edgeMid(oldBox.width / 2, 0);
        newP0 = { x: fixed.x - (newW / 2) * xAxis.x, y: fixed.y - (newW / 2) * xAxis.y };
    } else {
        fixed = edgeMid(oldBox.width / 2, oldBox.height);
        newP0 = {
            x: fixed.x - (newW / 2) * xAxis.x - newH * yAxis.x,
            y: fixed.y - (newW / 2) * xAxis.y - newH * yAxis.y,
        };
    }

    return { x: newP0.x, y: newP0.y, width: newW, height: newH, rotation: newBox.rotation };
}
