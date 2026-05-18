/**
 * Pre-crop helper for the wizard "Расширить фон" flow.
 *
 * Wizard image layers render with object-fit:cover, so the user only
 * ever sees the centred slice of the source that matches the layer's
 * aspect ratio. Everything outside that slice is invisible AND would
 * blow up the outpaint pipeline if we kept it: a tall source dropped
 * into a wide layer turns into a huge vertical padding in
 * image-pixel space (pixelScaleY explodes), tripping flux 2 pro's
 * 2560 / 4 MP caps and forcing a multipass bria fallback.
 *
 * This helper takes the same cover-style centred crop on the actual
 * source bytes BEFORE outpaint, so:
 *   - the cropped source has the same aspect ratio as the layer
 *     (pixelScale becomes symmetric — tested via the plan's pack
 *     numbers, scaleX ≈ scaleY ≈ 2.38 after crop)
 *   - we keep the exact pixels the user already sees in preview —
 *     no information loss from their perspective
 *   - the resulting outpaint canvas stays inside flux's caps, so
 *     the call goes through in one pass without bria/multipass.
 *
 * Output is `image/webp` at quality 0.95: near-lossless for
 * photographic content, ~4× smaller than PNG, and downstream
 * `compositeExpandResult` / `outpaintImage` handle data URIs fine.
 *
 * Failure modes are non-fatal: on any error (cross-origin load
 * failure, canvas context unavailable, etc.) the original src is
 * returned and the pipeline runs with un-cropped input. That's
 * strictly no worse than before this helper existed.
 */

const DEFAULT_ASPECT_TOLERANCE = 0.05;

export interface CropResult {
    /** Either the original src (cropped: false) or a webp data URI. */
    src: string;
    /** Width of the cropped image in image pixels. */
    nativeW: number;
    /** Height of the cropped image in image pixels. */
    nativeH: number;
    /** True if a crop actually happened, false if input already fit. */
    cropped: boolean;
}

export interface CropToLayerAspectOptions {
    /**
     * Maximum absolute difference between source and layer aspect
     * ratios that still counts as "already matches". Below this
     * threshold the helper short-circuits and returns the original src
     * untouched. Default 0.05.
     */
    tolerance?: number;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`cropToLayerAspect: failed to load ${src.slice(0, 80)}`));
        img.src = src;
    });
}

/**
 * Centre-crop `imageSrc` to match `layerAspect` (= layerW / layerH),
 * cover-style. See module docstring for the full rationale.
 */
export async function cropToLayerAspect(
    imageSrc: string,
    layerAspect: number,
    opts?: CropToLayerAspectOptions,
): Promise<CropResult> {
    const tolerance = opts?.tolerance ?? DEFAULT_ASPECT_TOLERANCE;

    if (!imageSrc || !Number.isFinite(layerAspect) || layerAspect <= 0) {
        return { src: imageSrc, nativeW: 0, nativeH: 0, cropped: false };
    }

    let img: HTMLImageElement;
    try {
        img = await loadImageElement(imageSrc);
    } catch (e) {
        // Fall through with the original src. Whoever calls us either
        // has a fresh CORS-safe URL or will see the same load failure
        // downstream in outpaintImage's own loadImage.
        console.warn("[cropToLayerAspect] load failed, falling back to original src", e);
        return { src: imageSrc, nativeW: 0, nativeH: 0, cropped: false };
    }

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (naturalW <= 0 || naturalH <= 0) {
        return { src: imageSrc, nativeW: naturalW, nativeH: naturalH, cropped: false };
    }

    const imageAspect = naturalW / naturalH;
    if (Math.abs(imageAspect - layerAspect) <= tolerance) {
        return { src: imageSrc, nativeW: naturalW, nativeH: naturalH, cropped: false };
    }

    let cropW: number;
    let cropH: number;
    if (imageAspect > layerAspect) {
        // Source is wider than the layer. Keep full height, trim width
        // (cover-style: the layer would have shown a centred horizontal
        // slice of the source).
        cropH = naturalH;
        cropW = Math.round(naturalH * layerAspect);
    } else {
        // Source is taller/narrower than the layer. Keep full width,
        // trim height.
        cropW = naturalW;
        cropH = Math.round(naturalW / layerAspect);
    }

    // Defensive: never produce a zero-size crop, even on degenerate
    // aspect inputs. Fall through to the original src in that case.
    if (cropW <= 0 || cropH <= 0 || cropW > naturalW || cropH > naturalH) {
        return { src: imageSrc, nativeW: naturalW, nativeH: naturalH, cropped: false };
    }

    const offsetX = Math.round((naturalW - cropW) / 2);
    const offsetY = Math.round((naturalH - cropH) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return { src: imageSrc, nativeW: naturalW, nativeH: naturalH, cropped: false };
    }

    try {
        ctx.drawImage(
            img,
            offsetX, offsetY, cropW, cropH,
            0, 0, cropW, cropH,
        );
        // WebP @ 0.95 is the same setting we use in compressImageFile
        // for outpaint preservation — near-lossless for photographic
        // content while keeping data URIs small enough to flow through
        // the JSON pipeline without 10 MB tRPC payload issues.
        const cropped = canvas.toDataURL("image/webp", 0.95);
        return { src: cropped, nativeW: cropW, nativeH: cropH, cropped: true };
    } catch (e) {
        // Tainted canvas (cross-origin) or out-of-memory on a huge
        // crop. Fall through with the original — outpaintImage's own
        // persistOrThrow will re-host non-S3 sources before retry.
        console.warn("[cropToLayerAspect] canvas draw failed, falling back to original src", e);
        return { src: imageSrc, nativeW: naturalW, nativeH: naturalH, cropped: false };
    }
}
