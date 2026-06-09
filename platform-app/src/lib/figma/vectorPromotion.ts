import type { ImageLayer, Layer, VectorLayer } from "@/types";
import { importedVectorToLayerProps, parseSvgToVector } from "@/utils/svgImport";

export const FIGMA_VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "LINE"]);

/**
 * After Figma `/v1/images` SVG renders are downloaded, promote matching
 * ImageLayers to VectorLayers with `inlineSvg` for faithful boolean/subtract output.
 */
export function promoteFigmaVectorLayers(
    layers: Layer[],
    vectorOverrides: Record<string, Partial<VectorLayer>>,
    layerUrls: Record<string, string>,
): Layer[] {
    return layers.map((layer) => {
        const url = layerUrls[layer.id];
        const overrides = vectorOverrides[layer.id];
        const originalType = layer.metadata?.figmaOriginalType;

        if (
            layer.type === "image"
            && overrides
            && originalType
            && FIGMA_VECTOR_TYPES.has(originalType)
        ) {
            const image = layer as ImageLayer;
            const vector: VectorLayer = {
                ...image,
                ...overrides,
                type: "vector",
                subpaths: overrides.subpaths ?? [],
                fill: overrides.fill ?? "#111827",
                src: url ?? image.src,
            };
            return vector;
        }

        if (layer.type === "image" && url) {
            return { ...layer, src: url };
        }

        return layer;
    });
}

/** Promote legacy Figma vector ImageLayers before SVG/EPS export (in-browser fetch). */
export async function promoteFigmaVectorImagesForExport(layers: Layer[]): Promise<Layer[]> {
    return Promise.all(layers.map(async (layer) => {
        if (layer.type !== "image") return layer;

        const originalType = layer.metadata?.figmaOriginalType;
        if (!originalType || !FIGMA_VECTOR_TYPES.has(originalType)) return layer;

        const src = layer.src;
        if (!src) return layer;

        try {
            const resp = await fetch(src);
            if (!resp.ok) return layer;

            const contentType = resp.headers.get("content-type") ?? "";
            const isSvg = contentType.includes("svg") || /\.svg(\?|$)/i.test(src);
            if (!isSvg) return layer;

            const imported = parseSvgToVector(await resp.text());
            if (!imported) return layer;

            const overrides = importedVectorToLayerProps(imported);
            const image = layer as ImageLayer;
            const vector: VectorLayer = {
                ...image,
                ...overrides,
                type: "vector",
                subpaths: overrides.subpaths ?? [],
                fill: overrides.fill ?? "#111827",
                src,
            };
            return vector;
        } catch {
            return layer;
        }
    }));
}
