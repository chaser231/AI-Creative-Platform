import type Konva from "konva";
import { SLICE_OVERLAY_NAME } from "@/components/editor/canvas/sliceOverlay";
import { MULTI_TRANSFORM_PROXY_ID } from "@/components/editor/canvas/GroupSelectionTransformer";

/** Konva nodes tagged with this name are studio-only and never exported. */
export const EDITOR_CHROME_NAME = "editor-chrome";

/** Konva `name` on the editable active-artboard group; used to read its world
 *  offset so raster crop bounds (expressed in artboard-local coords) capture the
 *  correct region in both single and overview view modes. */
export const EXPORT_ARTBOARD_FRAME_NAME = "export-artboard-frame";

/** The editable artboard frame group, or null if absent (e.g. no canvas yet). */
export function getArtboardFrameNode(stage: Konva.Stage): Konva.Node | null {
    return stage.findOne(`.${EXPORT_ARTBOARD_FRAME_NAME}`) ?? null;
}

/** World-space offset of the editable artboard frame. {0,0} in single view,
 *  the active tile offset in overview. Returns {0,0} if the frame is absent. */
export function getArtboardFrameOffset(stage: Konva.Stage): { x: number; y: number } {
    const frame = getArtboardFrameNode(stage);
    if (!frame) return { x: 0, y: 0 };
    return { x: frame.x(), y: frame.y() };
}

type VisibilityRestore = { node: Konva.Node; visible: boolean };

function collectEditorChromeNodes(stage: Konva.Stage): Konva.Node[] {
    const nodes: Konva.Node[] = [];

    stage.find(`.${SLICE_OVERLAY_NAME}`).forEach((node) => nodes.push(node));
    stage.find("Transformer").forEach((node) => nodes.push(node));
    stage.find(`.${EDITOR_CHROME_NAME}`).forEach((node) => nodes.push(node));

    const proxy = stage.findOne(`#${MULTI_TRANSFORM_PROXY_ID}`);
    if (proxy) nodes.push(proxy);

    return nodes;
}

/** Hide selection handles and other studio chrome; call the returned fn to restore. */
export function hideEditorChromeForCapture(stage: Konva.Stage): () => void {
    const restoreEntries: VisibilityRestore[] = [];
    const seen = new Set<Konva.Node>();

    for (const node of collectEditorChromeNodes(stage)) {
        if (seen.has(node)) continue;
        seen.add(node);
        restoreEntries.push({ node, visible: node.visible() });
        node.visible(false);
    }

    stage.batchDraw();

    return () => {
        for (let i = restoreEntries.length - 1; i >= 0; i -= 1) {
            const { node, visible } = restoreEntries[i];
            node.visible(visible);
        }
        stage.batchDraw();
    };
}

export function withEditorChromeHidden<T>(stage: Konva.Stage, fn: () => T): T {
    const restore = hideEditorChromeForCapture(stage);
    try {
        return fn();
    } finally {
        restore();
    }
}

export async function withEditorChromeHiddenAsync<T>(
    stage: Konva.Stage,
    fn: () => T | Promise<T>,
): Promise<T> {
    const restore = hideEditorChromeForCapture(stage);
    try {
        return await fn();
    } finally {
        restore();
    }
}
