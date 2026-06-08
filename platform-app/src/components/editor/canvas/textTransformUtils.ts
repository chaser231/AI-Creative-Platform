import Konva from "konva";
import type { TextLayer } from "@/types";

export const TEXT_LAYER_BOUNDS_NAME = "text-layer-bounds";
export const TEXT_LAYER_CONTENT_NAME = "text-layer-content";
export const FLIP_LAYER_CONTENT_NAME = "flip-layer-content";

const MIN_TEXT_LAYER_SIZE = 10;

type TextTransformLayer = Pick<TextLayer, "textAdjust" | "flipX" | "flipY">;

function isContainer(node: Konva.Node): node is Konva.Container {
    return typeof (node as Konva.Container).findOne === "function";
}

export function findTextTransformNodes(node: Konva.Node) {
    const container = isContainer(node) ? node : null;
    const boundsNode = container?.findOne<Konva.Rect>(`.${TEXT_LAYER_BOUNDS_NAME}`) ?? null;
    const namedTextNode = container?.findOne<Konva.Text>(`.${TEXT_LAYER_CONTENT_NAME}`) ?? null;
    const textNode = node instanceof Konva.Text
        ? node
        : namedTextNode ?? container?.findOne<Konva.Text>((child: Konva.Node) => child instanceof Konva.Text) ?? null;
    const flipNode = container?.findOne<Konva.Group>(`.${FLIP_LAYER_CONTENT_NAME}`) ?? null;

    return { boundsNode, textNode, flipNode };
}

export function syncTextTransformNodes(
    node: Konva.Node,
    layer: TextTransformLayer,
    width: number,
    height: number,
    options: { fixedPreview?: boolean } = {},
) {
    const nextWidth = Math.max(width, MIN_TEXT_LAYER_SIZE);
    const nextHeight = Math.max(height, MIN_TEXT_LAYER_SIZE);
    const { boundsNode, textNode, flipNode } = findTextTransformNodes(node);

    node.width(nextWidth);
    node.height(nextHeight);
    boundsNode?.width(nextWidth);
    boundsNode?.height(nextHeight);

    if (textNode) {
        textNode.width(nextWidth);
        textNode.height(nextHeight);
        if (options.fixedPreview && layer.textAdjust === "auto_width") {
            textNode.wrap("word");
        }
    }

    if (flipNode) {
        flipNode.x(layer.flipX ? nextWidth : 0);
        flipNode.y(layer.flipY ? nextHeight : 0);
    }

    return { width: nextWidth, height: nextHeight };
}

export function normalizeLiveTextTransform(node: Konva.Node, layer: TextTransformLayer) {
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const width = Math.max(node.width() * scaleX, MIN_TEXT_LAYER_SIZE);
    const height = Math.max(node.height() * scaleY, MIN_TEXT_LAYER_SIZE);
    const changed = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;

    if (changed) {
        node.scaleX(1);
        node.scaleY(1);
    }

    syncTextTransformNodes(node, layer, width, height, { fixedPreview: changed });

    return { width, height, changed };
}
