import type Konva from "konva";

/** Walk up the Konva tree to find the layer id (on the root Group of CanvasLayer). */
export function resolveKonvaLayerId(target: Konva.Node): string {
    let node: Konva.Node | null = target;
    while (node) {
        const id = node.id();
        if (id) return id;
        node = node.getParent();
    }
    return "";
}

/**
 * Namespaced Konva ids for the overview canvas (Phase 2 foundation).
 *
 * On the overview stage many artboards coexist, so layer ids are no longer
 * globally unique on their own — two formats can share the same layer id
 * (a resize is a snapshot of the same master layers). We disambiguate by
 * prefixing the owning format: `"${formatId}:${layerId}"`.
 *
 * Layer ids and format ids are uuids/slugs without a colon, so splitting on the
 * FIRST colon is unambiguous. A plain (non-namespaced) id round-trips with
 * `formatId === null`, keeping single-artboard studio editing untouched.
 */
const NAMESPACE_SEPARATOR = ":";

export function encodeNamespacedLayerId(formatId: string, layerId: string): string {
    return `${formatId}${NAMESPACE_SEPARATOR}${layerId}`;
}

export function decodeNamespacedLayerId(id: string): { formatId: string | null; layerId: string } {
    const separatorIndex = id.indexOf(NAMESPACE_SEPARATOR);
    if (separatorIndex === -1) return { formatId: null, layerId: id };
    return {
        formatId: id.slice(0, separatorIndex),
        layerId: id.slice(separatorIndex + 1),
    };
}

/** Like {@link resolveKonvaLayerId} but splits an `${formatId}:${layerId}` id. */
export function resolveNamespacedKonvaLayerId(target: Konva.Node): { formatId: string | null; layerId: string } {
    return decodeNamespacedLayerId(resolveKonvaLayerId(target));
}
