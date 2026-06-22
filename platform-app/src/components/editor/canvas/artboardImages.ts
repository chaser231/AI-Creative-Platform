"use client";

import { useEffect, useMemo, useReducer } from "react";
import type { ArtboardBackgroundImage, FrameLayer, ImageLayer, Layer as LayerType, LayerImageFill } from "@/types";

export type ImageLoadStatus = "loading" | "loaded" | "error";

export interface ArtboardImageOptions {
    backgroundImage?: ArtboardBackgroundImage;
    strokeMode?: "paint" | "image";
    strokeImage?: LayerImageFill;
}

/**
 * Shared image cache + loader for read-only artboard rendering.
 *
 * The overview canvas can mount dozens of artboard tiles (`ArtboardGroup`) plus
 * wizard `PreviewCanvas` tiles that frequently reference the SAME image URLs
 * (one template applied across many formats). To make that cheap and consistent
 * this module owns:
 *
 *  - `decodedImageCache` — insertion-ordered LRU of decoded `HTMLImageElement`s,
 *    so each unique URL is fetched/decoded once across all consumers.
 *  - `inFlight` — dedupes concurrent loads of the same URL to a single request.
 *  - `subscribers` — every live `useArtboardImages` hook subscribes; when ANY
 *    load settles we notify all of them so a tile that errored/loaded early
 *    re-renders once a sibling resolves the shared URL (fixes cross-tile stale
 *    "stuck loading/error" state).
 */
const MAX_CACHED_IMAGES = 200;
const decodedImageCache = new Map<string, HTMLImageElement>();
const failedSources = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const subscribers = new Set<() => void>();

function notifySubscribers() {
    subscribers.forEach((notify) => notify());
}

function cacheDecodedImage(src: string, image: HTMLImageElement) {
    // Move-to-most-recent + evict oldest beyond the cap (simple LRU by insertion).
    decodedImageCache.delete(src);
    decodedImageCache.set(src, image);
    if (decodedImageCache.size > MAX_CACHED_IMAGES) {
        const oldest = decodedImageCache.keys().next().value;
        if (oldest !== undefined) decodedImageCache.delete(oldest);
    }
}

function loadImage(src: string): Promise<void> {
    const existing = inFlight.get(src);
    if (existing) return existing;

    // A fresh attempt clears any prior failure so transient errors can recover
    // on remount / sources change.
    failedSources.delete(src);

    const promise = new Promise<void>((resolve) => {
        const image = new window.Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
            cacheDecodedImage(src, image);
            inFlight.delete(src);
            notifySubscribers();
            resolve();
        };
        image.onerror = () => {
            inFlight.delete(src);
            failedSources.add(src);
            notifySubscribers();
            resolve();
        };
        image.src = src;
    });

    inFlight.set(src, promise);
    return promise;
}

/**
 * Collects every image URL referenced by an artboard's layers + background.
 *
 * Pure (no React) so it can be unit-tested and reused outside hooks.
 */
export function collectArtboardImageSources(
    layers: LayerType[],
    options: ArtboardImageOptions = {},
): string[] {
    const { backgroundImage, strokeMode, strokeImage } = options;
    const sources: string[] = [];

    layers.forEach((layer) => {
        if (layer.visible === false) return;

        if (layer.type === "image" && (layer.fillMode ?? "image") === "image" && layer.src) {
            sources.push(layer.src);
        }
        if ((layer.type === "rectangle" || layer.type === "frame") && layer.fillMode === "image" && layer.imageFill?.src) {
            sources.push(layer.imageFill.src);
        }
        if (
            (layer.type === "rectangle" || layer.type === "frame" || layer.type === "image")
            && layer.strokeMode === "image"
            && layer.strokeImage?.src
        ) {
            sources.push((layer as ImageLayer | FrameLayer).strokeImage!.src);
        }
    });

    if (backgroundImage?.src) sources.push(backgroundImage.src);
    if (strokeMode === "image" && strokeImage?.src) sources.push(strokeImage.src);

    return Array.from(new Set(sources));
}

export interface ArtboardImagesResult {
    loadedImages: Map<string, HTMLImageElement>;
    imageStatuses: Record<string, ImageLoadStatus>;
    pending: number;
    failed: number;
}

/**
 * Loads (and globally caches) every image an artboard needs, returning a map of
 * decoded elements plus per-source load status. Replaces the per-component image
 * loading that previously lived inline in `PreviewCanvas`, shared now by both the
 * preview/export canvas and the world-space `ArtboardGroup` overview tiles.
 */
export function useArtboardImages(layers: LayerType[], options: ArtboardImageOptions = {}): ArtboardImagesResult {
    const { backgroundImage, strokeMode, strokeImage } = options;

    const sources = useMemo(
        () => collectArtboardImageSources(layers, { backgroundImage, strokeMode, strokeImage }),
        [layers, backgroundImage, strokeMode, strokeImage],
    );

    // Bumped (locally) whenever ANY shared load settles — see subscribers below.
    const [version, bumpVersion] = useReducer((count: number) => count + 1, 0);

    useEffect(() => {
        subscribers.add(bumpVersion);
        return () => {
            subscribers.delete(bumpVersion);
        };
    }, []);

    useEffect(() => {
        sources.forEach((src) => {
            if (decodedImageCache.has(src)) return;
            void loadImage(src);
        });
    }, [sources]);

    return useMemo(() => {
        const loadedImages = new Map<string, HTMLImageElement>();
        const imageStatuses: Record<string, ImageLoadStatus> = {};
        let pending = 0;
        let failed = 0;

        sources.forEach((src) => {
            const image = decodedImageCache.get(src);
            if (image) {
                loadedImages.set(src, image);
                imageStatuses[src] = "loaded";
            } else if (failedSources.has(src)) {
                imageStatuses[src] = "error";
                failed += 1;
            } else {
                imageStatuses[src] = "loading";
                pending += 1;
            }
        });

        return { loadedImages, imageStatuses, pending, failed };
        // `version` participates so freshly-settled shared loads surface here.
    }, [sources, version]);
}
