import { useEffect, useState } from "react";
import { FIGMA_VECTOR_TYPES } from "@/lib/figma/vectorPromotion";
import { parseSvgToVector } from "@/utils/svgImport";

/** Fetches a legacy Figma vector ImageLayer SVG and returns inlineSvg for canvas preview. */
export function useFigmaVectorInlineSvg(
    src: string | undefined,
    figmaOriginalType: string | undefined,
): string | undefined {
    const [inlineSvg, setInlineSvg] = useState<string | undefined>();

    useEffect(() => {
        if (!src || !figmaOriginalType || !FIGMA_VECTOR_TYPES.has(figmaOriginalType)) {
            setInlineSvg(undefined);
            return;
        }

        let cancelled = false;
        void (async () => {
            try {
                const resp = await fetch(src);
                if (!resp.ok) return;

                const contentType = resp.headers.get("content-type") ?? "";
                const isSvg = contentType.includes("svg") || /\.svg(\?|$)/i.test(src);
                if (!isSvg) return;

                const imported = parseSvgToVector(await resp.text());
                if (!cancelled && imported?.inlineSvg) {
                    setInlineSvg(imported.inlineSvg);
                }
            } catch {
                // Keep raster fallback on fetch/parse failure.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [src, figmaOriginalType]);

    return inlineSvg;
}
