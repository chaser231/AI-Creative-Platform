import type { Layer } from "@/types";

/**
 * Fetch raster image layers and encode them as base64 data-URIs so vector
 * exports (SVG) are self-contained and render offline / cross-origin.
 */
export async function buildEmbeddedImageMap(layers: Layer[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const imageLayers = layers.filter((l): l is Layer & { type: "image"; src: string } => l.type === "image" && !!(l as { src?: string }).src);

    await Promise.all(
        imageLayers.map(async (layer) => {
            const src = layer.src;
            if (src.startsWith("data:")) {
                result.set(layer.id, src);
                return;
            }
            try {
                const res = await fetch(src, { mode: "cors" });
                if (!res.ok) return;
                const blob = await res.blob();
                const dataUrl = await new Promise<string | null>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (dataUrl) result.set(layer.id, dataUrl);
            } catch {
                // Leave unembedded; the exporter falls back to the original URL.
            }
        }),
    );

    return result;
}
