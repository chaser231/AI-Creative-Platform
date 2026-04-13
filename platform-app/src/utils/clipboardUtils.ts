/**
 * clipboardUtils — Copy/Paste layers via system clipboard
 *
 * Supports:
 * - Copy/Cut selected layers (including nested frame children)
 * - Paste layers with remapped IDs
 * - Copy layer as PNG to system clipboard
 */

import type { Layer, FrameLayer } from "@/types";
import Konva from "konva";

// ─── Clipboard Data Format ─────────────────────────────

const CLIPBOARD_MARKER = "ai-creative-platform-layers" as const;

export interface ClipboardLayerData {
    type: typeof CLIPBOARD_MARKER;
    version: 1;
    layers: Layer[];
    sourceProjectId?: string;
    sourceFormatId?: string;
}

// ─── Collect Layer Tree ────────────────────────────────

/**
 * Recursively collect selected layers + all nested children (for frames).
 * Deduplicates: if both a frame and its child are selected, the child
 * won't be collected twice.
 */
export function collectLayerTree(
    layerIds: string[],
    allLayers: Layer[]
): Layer[] {
    const collected = new Map<string, Layer>();

    const collectRecursive = (id: string) => {
        if (collected.has(id)) return;
        const layer = allLayers.find(l => l.id === id);
        if (!layer) return;
        collected.set(id, layer);

        // If it's a frame, also collect all children recursively
        if (layer.type === "frame") {
            const frame = layer as FrameLayer;
            for (const childId of frame.childIds) {
                collectRecursive(childId);
            }
        }
    };

    for (const id of layerIds) {
        collectRecursive(id);
    }

    return Array.from(collected.values());
}

// ─── Copy Layers to Clipboard ──────────────────────────

/**
 * Serialize selected layers (with children) to JSON and write to
 * the system clipboard as text.
 */
export async function copyLayersToClipboard(
    layerIds: string[],
    allLayers: Layer[],
    projectId?: string,
    formatId?: string,
): Promise<boolean> {
    if (layerIds.length === 0) return false;

    const layers = collectLayerTree(layerIds, allLayers);
    if (layers.length === 0) return false;

    const data: ClipboardLayerData = {
        type: CLIPBOARD_MARKER,
        version: 1,
        layers,
        sourceProjectId: projectId,
        sourceFormatId: formatId,
    };

    try {
        await navigator.clipboard.writeText(JSON.stringify(data));
        return true;
    } catch (err) {
        console.error("[clipboard] Failed to copy layers:", err);
        return false;
    }
}

// ─── Paste Layers from Clipboard ───────────────────────

/**
 * Read the system clipboard, parse JSON, validate the marker,
 * and return the raw layer array. Returns null if clipboard
 * doesn't contain our data.
 */
export async function pasteLayersFromClipboard(): Promise<ClipboardLayerData | null> {
    try {
        const text = await navigator.clipboard.readText();
        if (!text) return null;

        const data = JSON.parse(text);
        if (data?.type !== CLIPBOARD_MARKER || !Array.isArray(data?.layers)) {
            return null;
        }

        return data as ClipboardLayerData;
    } catch {
        // Not our data or permission denied
        return null;
    }
}

// ─── Copy Layer as PNG ─────────────────────────────────

/**
 * Render a layer (or group of layers) via Konva to PNG,
 * then write it to the system clipboard as an image/png blob.
 */
export async function copyLayerAsPng(
    stage: Konva.Stage,
    layerIds: string[],
    allLayers: Layer[],
): Promise<boolean> {
    if (layerIds.length === 0 || !stage) return false;

    try {
        // Save current transform
        const oldScale = stage.scaleX();
        const oldPos = stage.position();
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });

        let dataURL: string | null = null;

        if (layerIds.length === 1) {
            // Single layer — try to find its Konva node
            const node = stage.findOne(`#${layerIds[0]}`);
            if (node) {
                dataURL = node.toDataURL({
                    pixelRatio: 2,
                    mimeType: "image/png",
                });
            }
        }

        if (!dataURL) {
            // Fallback: render the bounding box region from the stage
            const targetLayers = allLayers.filter(l => layerIds.includes(l.id));
            if (targetLayers.length === 0) {
                // Restore transform
                stage.scale({ x: oldScale, y: oldScale });
                stage.position(oldPos);
                stage.batchDraw();
                return false;
            }

            const minX = Math.min(...targetLayers.map(l => l.x));
            const minY = Math.min(...targetLayers.map(l => l.y));
            const maxX = Math.max(...targetLayers.map(l => l.x + l.width));
            const maxY = Math.max(...targetLayers.map(l => l.y + l.height));

            dataURL = stage.toDataURL({
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                pixelRatio: 2,
                mimeType: "image/png",
            });
        }

        // Restore transform
        stage.scale({ x: oldScale, y: oldScale });
        stage.position(oldPos);
        stage.batchDraw();

        if (!dataURL) return false;

        // Convert data URL to Blob
        const res = await fetch(dataURL);
        const blob = await res.blob();

        // Write to clipboard as image
        await navigator.clipboard.write([
            new ClipboardItem({
                "image/png": blob,
            }),
        ]);

        return true;
    } catch (err) {
        console.error("[clipboard] Failed to copy as PNG:", err);
        return false;
    }
}
