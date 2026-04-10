/**
 * cloneLayerTree — Deep-clone a layer array with remapped IDs
 *
 * Creates a complete copy of a layer tree where every layer gets a new UUID,
 * and all internal references (parentId, childIds) are remapped accordingly.
 * This is essential for per-format snapshots where each format needs
 * independent layer instances.
 */

import type { Layer } from "@/types";
import { v4 as uuid } from "uuid";

/**
 * Deep-clone an array of layers, assigning new IDs and remapping all
 * parent-child references (parentId, childIds) to the new IDs.
 */
export function cloneLayerTree(layers: Layer[]): Layer[] {
    if (layers.length === 0) return [];

    // Build old→new ID mapping
    const idMap = new Map<string, string>();
    for (const layer of layers) {
        idMap.set(layer.id, uuid());
    }

    // Clone each layer with remapped references
    return layers.map(layer => {
        const newId = idMap.get(layer.id)!;
        const cloned = { ...layer, id: newId } as any;

        // Remap parentId (runtime property, not always in type)
        if (cloned.parentId && idMap.has(cloned.parentId)) {
            cloned.parentId = idMap.get(cloned.parentId)!;
        }

        // Remap childIds (frames)
        if (cloned.type === "frame" && cloned.childIds) {
            cloned.childIds = cloned.childIds
                .map((cid: string) => idMap.get(cid) ?? cid)
                .filter((cid: string) => cid !== undefined);
        }

        // Clear masterId — cloned layers are independent
        delete cloned.masterId;

        return cloned as Layer;
    });
}
