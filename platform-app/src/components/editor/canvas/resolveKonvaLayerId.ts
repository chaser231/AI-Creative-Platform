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
