"use client";

import { useEffect, useState } from "react";
import { Image as KonvaImage } from "react-konva";

/**
 * Renders an imported boolean/subtract/even-odd vector via native browser SVG
 * rasterization (faithful preview). Used wherever a `VectorLayer` carries an
 * `inlineSvg` snapshot whose geometry cannot be reproduced by a Konva `<Path>`
 * (empty subpaths). Shared by the interactive studio `Canvas` and the read-only
 * `ArtboardLayer` (overview tiles + `PreviewCanvas`) so every surface paints the
 * same faithful raster.
 */
export function InlineSvgVectorImage({
    inlineSvg,
    width,
    height,
}: {
    inlineSvg: string;
    width: number;
    height: number;
}) {
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    useEffect(() => {
        // Drop the previous raster so a stale SVG never lingers while the new
        // one decodes (e.g. switching format/preview).
        setImage(null);
        const img = new window.Image();
        img.onload = () => setImage(img);
        img.onerror = () => setImage(null);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inlineSvg)}`;
        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [inlineSvg]);
    if (!image) return null;
    return <KonvaImage image={image} width={width} height={height} listening={false} perfectDrawEnabled={false} />;
}
