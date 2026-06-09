export interface TransformableLayerSnap {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    lockAspectRatio?: boolean;
}

export interface AxisBBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function computeUnionBBox(layers: TransformableLayerSnap[]): AxisBBox {
    if (layers.length === 0) {
        return { x: 0, y: 0, width: 1, height: 1 };
    }
    const minX = Math.min(...layers.map((l) => l.x));
    const minY = Math.min(...layers.map((l) => l.y));
    const maxX = Math.max(...layers.map((l) => l.x + l.width));
    const maxY = Math.max(...layers.map((l) => l.y + l.height));
    return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
    };
}

export interface LayerGeometryUpdate {
    x: number;
    y: number;
    width: number;
    height: number;
}

function clampGeom(geom: LayerGeometryUpdate): LayerGeometryUpdate {
    return {
        x: Number.isFinite(geom.x) ? geom.x : 0,
        y: Number.isFinite(geom.y) ? geom.y : 0,
        width: Math.max(1, Number.isFinite(geom.width) ? geom.width : 1),
        height: Math.max(1, Number.isFinite(geom.height) ? geom.height : 1),
    };
}

/** Distribute a group bbox resize to member layers (center-relative, Figma-like). */
export function distributeGroupTransform(
    initialLayers: TransformableLayerSnap[],
    initialGroup: AxisBBox,
    nextGroup: AxisBBox,
): Map<string, LayerGeometryUpdate> {
    if (initialGroup.width <= 0 || initialGroup.height <= 0) {
        return new Map();
    }

    const sx = nextGroup.width / initialGroup.width;
    const sy = nextGroup.height / initialGroup.height;
    const oldCx = initialGroup.x + initialGroup.width / 2;
    const oldCy = initialGroup.y + initialGroup.height / 2;
    const newCx = nextGroup.x + nextGroup.width / 2;
    const newCy = nextGroup.y + nextGroup.height / 2;

    const result = new Map<string, LayerGeometryUpdate>();
    for (const layer of initialLayers) {
        const lcx = layer.x + layer.width / 2;
        const lcy = layer.y + layer.height / 2;
        const relX = (lcx - oldCx) / initialGroup.width;
        const relY = (lcy - oldCy) / initialGroup.height;

        const newLcx = newCx + relX * nextGroup.width;
        const newLcy = newCy + relY * nextGroup.height;

        let nw = layer.width * sx;
        let nh = layer.height * sy;
        if (layer.lockAspectRatio) {
            const dominant = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
            nw = layer.width * dominant;
            nh = layer.height * dominant;
        }

        result.set(layer.id, clampGeom({
            x: newLcx - nw / 2,
            y: newLcy - nh / 2,
            width: nw,
            height: nh,
        }));
    }

    return result;
}

export function proxyNodeToGroupBBox(proxy: {
    x: () => number;
    y: () => number;
    width: () => number;
    height: () => number;
    scaleX: () => number;
    scaleY: () => number;
}): AxisBBox {
    const scaleX = proxy.scaleX();
    const scaleY = proxy.scaleY();
    return clampGeom({
        x: proxy.x(),
        y: proxy.y(),
        width: proxy.width() * Math.abs(scaleX),
        height: proxy.height() * Math.abs(scaleY),
    });
}

/** Sync the multi-select proxy rect to a union bbox (scene coords). */
export function applyBBoxToProxy(proxy: {
    x: (v: number) => void;
    y: (v: number) => void;
    width: (v: number) => void;
    height: (v: number) => void;
    scaleX: (v: number) => void;
    scaleY: (v: number) => void;
}, bbox: AxisBBox): void {
    proxy.x(bbox.x);
    proxy.y(bbox.y);
    proxy.width(bbox.width);
    proxy.height(bbox.height);
    proxy.scaleX(1);
    proxy.scaleY(1);
}

export function computeUnionBBoxFromDrag(
    layers: TransformableLayerSnap[],
    dragStarts: Record<string, { x: number; y: number }>,
    dx: number,
    dy: number,
): AxisBBox | null {
    const ids = Object.keys(dragStarts);
    if (ids.length < 2) return null;

    const snaps: TransformableLayerSnap[] = [];
    for (const id of ids) {
        const layer = layers.find((l) => l.id === id);
        const start = dragStarts[id];
        if (!layer || !start) continue;
        snaps.push({
            ...layer,
            x: start.x + dx,
            y: start.y + dy,
        });
    }
    if (snaps.length < 2) return null;
    return computeUnionBBox(snaps);
}
