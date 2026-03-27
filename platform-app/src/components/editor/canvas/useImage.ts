"use client";

import { useState, useEffect } from "react";

export function useImage(src: string): HTMLImageElement | undefined {
    const [loadedImg, setLoadedImg] = useState<HTMLImageElement | undefined>(undefined);
    useEffect(() => {
        if (!src) return;
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
            setLoadedImg(img);
        };
    }, [src]);
    return loadedImg;
}
