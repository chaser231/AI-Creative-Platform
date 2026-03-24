/**
 * Canvas Store — Helper Functions
 *
 * Pure utility functions used by canvas store slices.
 * Extracted from the monolithic canvasStore.ts for maintainability.
 */

import { CONTENT_SOURCE_KEYS, DEFAULT_CONSTRAINTS } from "@/types";
import type {
    Layer,
    FrameLayer,
    MasterComponent,
    ComponentInstance,
    ComponentProps,
    LayerConstraints,
} from "./types";
import type { FrameResizeDelta } from "./types";

// ─── Constraint computation ─────────────────────────────

/**
 * Given a child's absolute position/size and the parent frame's old & new
 * bounds, returns the child's new absolute position/size that honours its
 * `constraints` setting.
 */
export function computeConstrainedPosition(
    child: { x: number; y: number; width: number; height: number; constraints?: LayerConstraints },
    delta: FrameResizeDelta,
): { x: number; y: number; width: number; height: number } {
    const c = child.constraints ?? DEFAULT_CONSTRAINTS;
    const { oldX, oldY, oldWidth, oldHeight, newX, newY, newWidth, newHeight } = delta;

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

// ─── Content-source keys extraction ─────────────────────

/**
 * Extract content-source keys from master props for a given component type.
 */
export function getContentSourceUpdates(master: MasterComponent): Record<string, unknown> {
    const keys = CONTENT_SOURCE_KEYS[master.type] || [];
    const updates: Record<string, unknown> = {};
    const props = master.props as unknown as Record<string, unknown>;
    for (const key of keys) {
        updates[key] = props[key];
    }
    return updates;
}

// ─── Frame ↔ Master/Instance sync helpers ───────────────

/**
 * Sync `childIds` from runtime layers back into masterComponent props.
 * Keeps nesting intact when switching resize formats.
 */
export function syncFrameChildIdsToMasters(
    layers: Layer[],
    masters: MasterComponent[],
): MasterComponent[] {
    return masters.map((m) => {
        if (m.type !== "frame") return m;
        const frameLayer = layers.find((l) => l.masterId === m.id && l.type === "frame") as FrameLayer | undefined;
        if (!frameLayer) return m;
        const frameProps = m.props as FrameLayer;
        if (JSON.stringify(frameProps.childIds) === JSON.stringify(frameLayer.childIds)) return m;
        return { ...m, props: { ...m.props, childIds: [...frameLayer.childIds] } as ComponentProps };
    });
}

export function syncFrameChildIdsToInstances(
    layers: Layer[],
    masters: MasterComponent[],
    instances: ComponentInstance[],
    activeResizeId: string,
): ComponentInstance[] {
    return instances.map((inst) => {
        const master = masters.find((m) => m.id === inst.masterId);
        if (!master || master.type !== "frame") return inst;
        const frameLayer = layers.find((l) => l.masterId === master.id && l.type === "frame") as FrameLayer | undefined;
        if (!frameLayer) return inst;
        if (inst.resizeId !== activeResizeId) return inst;
        const instProps = inst.localProps as FrameLayer;
        if (JSON.stringify(instProps.childIds) === JSON.stringify(frameLayer.childIds)) return inst;
        return { ...inst, localProps: { ...inst.localProps, childIds: [...frameLayer.childIds] } as ComponentProps };
    });
}

// ─── Derived layout sync ────────────────────────────────

/** Layout-geometry keys that auto-layout may change on any layer */
const LAYOUT_GEOMETRY_KEYS: (keyof Layer)[] = ["x", "y", "width", "height"];

/**
 * Compare `oldLayers` with `newLayers` (post-auto-layout) and sync any
 * positional / dimensional changes back to the active Source of Truth
 * (masterComponents when on master resize, componentInstances otherwise).
 */
export function syncDerivedLayoutToSource(
    oldLayers: Layer[],
    newLayers: Layer[],
    masters: MasterComponent[],
    instances: ComponentInstance[],
    activeResizeId: string,
): { masterComponents: MasterComponent[]; componentInstances: ComponentInstance[] } {
    const oldMap = new Map<string, Layer>();
    oldLayers.forEach(l => oldMap.set(l.id, l));

    const diffs = new Map<string, Partial<Layer>>();
    for (const nl of newLayers) {
        const ol = oldMap.get(nl.id);
        if (!ol || !nl.masterId) continue;
        const diff: Record<string, unknown> = {};
        let hasDiff = false;
        for (const key of LAYOUT_GEOMETRY_KEYS) {
            const oldVal = (ol as unknown as Record<string, unknown>)[key];
            const newVal = (nl as unknown as Record<string, unknown>)[key];
            if (oldVal !== newVal) {
                diff[key] = newVal;
                hasDiff = true;
            }
        }
        if (nl.type === "frame") {
            const olFrame = ol as FrameLayer;
            const nlFrame = nl as FrameLayer;
            if (JSON.stringify(olFrame.childIds) !== JSON.stringify(nlFrame.childIds)) {
                diff.childIds = [...nlFrame.childIds];
                hasDiff = true;
            }
        }
        if (hasDiff) {
            diffs.set(nl.id, diff as Partial<Layer>);
        }
    }

    if (diffs.size === 0) {
        return { masterComponents: masters, componentInstances: instances };
    }

    const layerToMaster = new Map<string, string>();
    newLayers.forEach(l => { if (l.masterId) layerToMaster.set(l.id, l.masterId); });

    if (activeResizeId === "master") {
        const updatedMasters = masters.map(m => {
            const layerId = [...layerToMaster.entries()].find(([, mid]) => mid === m.id)?.[0];
            if (!layerId) return m;
            const diff = diffs.get(layerId);
            if (!diff) return m;
            return { ...m, props: { ...m.props, ...diff } as ComponentProps };
        });
        return { masterComponents: updatedMasters, componentInstances: instances };
    } else {
        const updatedInstances = instances.map(inst => {
            if (inst.resizeId !== activeResizeId) return inst;
            const layerId = [...layerToMaster.entries()].find(([, mid]) => mid === inst.masterId)?.[0];
            if (!layerId) return inst;
            const diff = diffs.get(layerId);
            if (!diff) return inst;
            return { ...inst, localProps: { ...inst.localProps, ...diff } as ComponentProps };
        });
        return { masterComponents: masters, componentInstances: updatedInstances };
    }
}

// ─── Shared frame child helpers ─────────────────────────

/**
 * Recursively collect all child IDs of a frame layer.
 */
export function collectFrameChildIds(layerId: string, layers: Layer[]): Set<string> {
    const ids = new Set<string>();
    const collect = (fid: string) => {
        const f = layers.find(l => l.id === fid) as FrameLayer | undefined;
        if (f && f.childIds) {
            f.childIds.forEach(cid => {
                ids.add(cid);
                const child = layers.find(l => l.id === cid);
                if (child?.type === "frame") collect(cid);
            });
        }
    };
    collect(layerId);
    return ids;
}

/**
 * Compute delta-moved layers for frame position changes.
 * Returns updated layers array with frame children moved by dx/dy.
 */
export function computeFrameChildMoves(
    currentLayers: Layer[],
    targetId: string,
    updates: Partial<Layer>,
): Layer[] {
    const targetLayer = currentLayers.find(l => l.id === targetId);
    if (!targetLayer) return currentLayers;

    let dx = 0;
    let dy = 0;
    if (targetLayer.type === "frame" && (updates.x !== undefined || updates.y !== undefined)) {
        if (updates.x !== undefined) dx = (updates.x as number) - targetLayer.x;
        if (updates.y !== undefined) dy = (updates.y as number) - targetLayer.y;
    }

    const childrenIdsToMove = new Set<string>();
    if ((dx !== 0 || dy !== 0) && targetLayer.type === "frame") {
        const collect = (fid: string) => {
            const f = currentLayers.find(l => l.id === fid) as FrameLayer;
            if (f && f.childIds) {
                f.childIds.forEach(cid => {
                    childrenIdsToMove.add(cid);
                    const child = currentLayers.find(l => l.id === cid);
                    if (child?.type === "frame") collect(cid);
                });
            }
        };
        collect(targetId);
    }

    return currentLayers.map(l => {
        if (l.id === targetId) return { ...l, ...updates } as Layer;
        if (childrenIdsToMove.has(l.id)) {
            return { ...l, x: l.x + dx, y: l.y + dy } as Layer;
        }
        return l;
    });
}
