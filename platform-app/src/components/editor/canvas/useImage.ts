"use client";

import { useState, useEffect } from "react";

/**
 * Loads an HTMLImageElement for the given URL.
 *
 * Returns `undefined` while loading or on error (caller should null-check).
 *
 * Internal state is keyed by `src` so an old image element is never returned
 * for a newer URL — even if the previous load is still in-flight when `src`
 * changes (we discard late onload via a `cancelled` flag in cleanup).
 *
 * Errors are logged and result in a stable `undefined` return so the canvas
 * keeps rendering the rest of the scene.
 */
export function useImage(src: string): HTMLImageElement | undefined {
    const [entry, setEntry] = useState<{ src: string; img: HTMLImageElement } | undefined>(undefined);

    useEffect(() => {
        if (!src) return;

        let cancelled = false;
        const img = new window.Image();
        img.crossOrigin = "anonymous";

        img.onload = () => {
            if (cancelled) return;
            setEntry({ src, img });
        };
        img.onerror = (err) => {
            if (cancelled) return;
            console.warn("[useImage] Failed to load image", { src, err });
        };

        img.src = src;

        return () => {
            cancelled = true;
            img.onload = null;
            img.onerror = null;
        };
    }, [src]);

    // Only return the image if it matches the requested src — guards against
    // briefly returning a stale image while a new one is being fetched.
    return entry?.src === src ? entry.img : undefined;
}
