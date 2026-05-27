import { computeImageFitProps, type ImageViewIntentLike } from "@/utils/imageFitUtils";
import { computeWizardWorkingAssetSize, type PixelSize } from "@/utils/packOutpaintPlan";
import type { ImageFitMode } from "@/types";

export interface WizardWorkingImageLayer {
    width: number;
    height: number;
    objectFit?: ImageFitMode;
    focusX?: number;
    focusY?: number;
}

export interface WizardWorkingImageResult {
    src: string;
    nativeW: number;
    nativeH: number;
    changed: boolean;
    crop: { x: number; y: number; width: number; height: number };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`prepareWizardWorkingImage: failed to load ${src.slice(0, 80)}`));
        img.src = src;
    });
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1;
}

export async function prepareWizardWorkingImage(
    imageSrc: string,
    layer: WizardWorkingImageLayer,
    packFormats: PixelSize[],
): Promise<WizardWorkingImageResult> {
    if (!imageSrc || layer.width <= 0 || layer.height <= 0) {
        return {
            src: imageSrc,
            nativeW: 0,
            nativeH: 0,
            changed: false,
            crop: { x: 0, y: 0, width: 0, height: 0 },
        };
    }

    let img: HTMLImageElement;
    try {
        img = await loadImageElement(imageSrc);
    } catch (e) {
        console.warn("[prepareWizardWorkingImage] load failed, falling back to original", e);
        return {
            src: imageSrc,
            nativeW: 0,
            nativeH: 0,
            changed: false,
            crop: { x: 0, y: 0, width: 0, height: 0 },
        };
    }

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (naturalW <= 0 || naturalH <= 0) {
        return {
            src: imageSrc,
            nativeW: naturalW,
            nativeH: naturalH,
            changed: false,
            crop: { x: 0, y: 0, width: naturalW, height: naturalH },
        };
    }

    const intent: ImageViewIntentLike = { focusX: layer.focusX, focusY: layer.focusY };
    const fit = computeImageFitProps(
        layer.objectFit ?? "cover",
        naturalW,
        naturalH,
        layer.width,
        layer.height,
        intent,
    );

    const cropX = Math.max(0, Math.round(fit.cropX));
    const cropY = Math.max(0, Math.round(fit.cropY));
    const cropW = Math.max(1, Math.min(naturalW - cropX, Math.round(fit.cropWidth)));
    const cropH = Math.max(1, Math.min(naturalH - cropY, Math.round(fit.cropHeight)));
    const target = computeWizardWorkingAssetSize(
        { width: cropW, height: cropH },
        { width: layer.width, height: layer.height },
        packFormats,
    );

    const cropIsFull = cropX === 0 && cropY === 0 && cropW === naturalW && cropH === naturalH;
    const sizeIsSame = nearlyEqual(target.width, cropW) && nearlyEqual(target.height, cropH);
    if (cropIsFull && sizeIsSame) {
        return {
            src: imageSrc,
            nativeW: naturalW,
            nativeH: naturalH,
            changed: false,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        };
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return {
            src: imageSrc,
            nativeW: naturalW,
            nativeH: naturalH,
            changed: false,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        };
    }

    // The downstream GPT outpaint pipeline assumes a uniform scale between the
    // crop rect and the working derivative. A non-uniform stretch here would
    // make the planner's scaleX != scaleY, which in turn skews the source
    // placement and is one of the documented sources of the wizard outpaint
    // shift artifact. Detect it explicitly and fall back to the original when
    // the rounding drift exceeds half a percent.
    const scaleX = target.width / cropW;
    const scaleY = target.height / cropH;
    const scaleDrift = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
    if (scaleDrift > 0.005) {
        console.warn(
            "[prepareWizardWorkingImage] non-uniform target scale, returning untouched source",
            { cropW, cropH, target, scaleX, scaleY, scaleDrift },
        );
        return {
            src: imageSrc,
            nativeW: naturalW,
            nativeH: naturalH,
            changed: false,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        };
    }

    try {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, target.width, target.height);
        return {
            src: canvas.toDataURL("image/webp", 0.95),
            nativeW: target.width,
            nativeH: target.height,
            changed: true,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        };
    } catch (e) {
        console.warn("[prepareWizardWorkingImage] canvas draw failed, falling back to original", e);
        return {
            src: imageSrc,
            nativeW: naturalW,
            nativeH: naturalH,
            changed: false,
            crop: { x: cropX, y: cropY, width: cropW, height: cropH },
        };
    }
}
