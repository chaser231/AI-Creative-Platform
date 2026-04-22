"use client";

/**
 * useProjectLibrary
 *
 * Single point of entry the canvas / prompt bars use to register images in
 * the project's local asset library. All paths share the same flow:
 *
 *   local File / base64 → S3 (uploadImageToS3)  \
 *   external URL        → S3 (uploadExternal…)   →  asset.attachUrlToProject
 *   workspace Asset (id) ─────────────────────── →  asset.cloneAssetToProject
 *
 * After a successful registration we invalidate the project/workspace asset
 * lists so the library panel, dashboard, and Assets modal all refresh
 * without a full reload. All errors are reported as console warnings, never
 * thrown — the library is a nice-to-have mirror, it must not break the
 * primary flow (image landing on the canvas) if the DB write trips.
 */

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
    uploadImageToS3,
    uploadExternalUrlToS3,
    compressImageFile,
} from "@/utils/imageUpload";

export interface RegisterFileOptions {
    projectId: string;
    file: File;
    source?: string;
}

export interface RegisterUrlOptions {
    projectId: string;
    url: string;
    source?: string;
    mimeType?: string;
    width?: number;
    height?: number;
}

export interface RegisterAssetOptions {
    assetId: string;
    targetProjectId: string;
    source?: string;
}

export interface UseProjectLibraryResult {
    /**
     * Compress a File, upload it to S3, register the Asset in the target
     * project library, and return the S3 URL (or null if the upload failed).
     */
    registerFile: (opts: RegisterFileOptions) => Promise<string | null>;
    /** Register an already-S3-or-external URL as a project asset. */
    registerUrl: (opts: RegisterUrlOptions) => Promise<string | null>;
    /** Clone an existing Asset into another project in the same workspace. */
    registerExistingAsset: (opts: RegisterAssetOptions) => Promise<void>;
}

export function useProjectLibrary(): UseProjectLibraryResult {
    const utils = trpc.useUtils();
    const attachUrl = trpc.asset.attachUrlToProject.useMutation();
    const cloneAsset = trpc.asset.cloneAssetToProject.useMutation();

    const invalidate = useCallback(
        async (projectId: string) => {
            await Promise.all([
                utils.asset.listByProject
                    .invalidate({ projectId })
                    .catch(() => undefined),
                utils.asset.listByWorkspace
                    .invalidate()
                    .catch(() => undefined),
            ]);
        },
        [utils],
    );

    const registerFile = useCallback(
        async ({ projectId, file, source = "upload" }: RegisterFileOptions) => {
            try {
                const base64 = await compressImageFile(file);
                const url = await uploadImageToS3(
                    base64,
                    projectId,
                    file.type || "image/png",
                );
                if (!url) return null;

                await attachUrl
                    .mutateAsync({
                        projectId,
                        url,
                        filename: file.name,
                        mimeType: file.type || "image/png",
                        sizeBytes: file.size,
                        source,
                    })
                    .catch((e) =>
                        console.warn("attachUrlToProject failed (file):", e),
                    );
                await invalidate(projectId);
                return url;
            } catch (e) {
                console.warn("registerFile failed:", e);
                return null;
            }
        },
        [attachUrl, invalidate],
    );

    const registerUrl = useCallback(
        async ({
            projectId,
            url,
            source = "upload",
            mimeType = "image/png",
            width,
            height,
        }: RegisterUrlOptions) => {
            if (!url) return null;
            try {
                // If the URL is not already on our S3, persist it first so we
                // never link the library to something that could 404 later.
                let persisted = url;
                if (!url.includes("storage.yandexcloud.net")) {
                    const up = await uploadExternalUrlToS3(url, projectId);
                    if (up) persisted = up;
                }
                await attachUrl
                    .mutateAsync({
                        projectId,
                        url: persisted,
                        mimeType,
                        source,
                        width,
                        height,
                    })
                    .catch((e) =>
                        console.warn("attachUrlToProject failed (url):", e),
                    );
                await invalidate(projectId);
                return persisted;
            } catch (e) {
                console.warn("registerUrl failed:", e);
                return null;
            }
        },
        [attachUrl, invalidate],
    );

    const registerExistingAsset = useCallback(
        async ({
            assetId,
            targetProjectId,
            source = "cloned",
        }: RegisterAssetOptions) => {
            try {
                await cloneAsset.mutateAsync({
                    assetId,
                    targetProjectId,
                    source,
                });
                await invalidate(targetProjectId);
            } catch (e) {
                console.warn("cloneAssetToProject failed:", e);
            }
        },
        [cloneAsset, invalidate],
    );

    return { registerFile, registerUrl, registerExistingAsset };
}
