/**
 * Figma Import Worker.
 *
 * Runs the full Phase 1 import pipeline for a single `FigmaImport` row:
 *
 *     PENDING → FETCHING → MAPPING → DOWNLOADING_ASSETS → CREATING_PROJECT → COMPLETED
 *
 * Failures transition to FAILED with `error` populated. Progress is a coarse
 * 0..100 percentage the UI polls for.
 *
 * Execution model: fire-and-forget inside the tRPC mutation. That's fine for
 * Phase 1 on Yandex Serverless Containers because the runtime keeps alive for
 * the duration of outstanding async work within a request. If we hit the
 * 15-minute limit or need crash safety, Phase 4 will introduce a proper queue
 * (likely Redis + BullMQ alongside the round-trip webhooks).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/server/db";
import {
    collectS3KeysFromAssets,
    collectS3KeysFromCanvasState,
    deleteS3Objects,
} from "@/server/utils/s3-cleanup";
import type { CanvasState } from "@/types/api-types";
import type { ArtboardProps } from "@/store/canvas/types";
import type { Layer, ResizeFormat } from "@/types";
import { createFigmaClientForUser } from "./client";
import { downloadAssetsForFrames } from "./assets";
import { findNodeById, mapFigmaDocument, type MapperResult } from "./mapper";
import type { FigmaImportOptions, ImportReport } from "./types";
import { emptyReport } from "./types";

// ─── Public API ─────────────────────────────────────────────────────────────

export interface StartImportArgs {
    importId: string;
    userId: string;
    workspaceId: string;
    fileKey: string;
    nodeId?: string;
    projectName?: string;
    options?: FigmaImportOptions;
}

/**
 * Kick off the worker. Returns immediately. The caller is expected to poll
 * `figma.getImportStatus({ importId })` for progress.
 */
export function startFigmaImport(args: StartImportArgs, prismaOverride?: PrismaClient): void {
    const prisma = prismaOverride ?? defaultPrisma;
    // No `await` here — the UI polls for status.
    runImport(args, prisma).catch(async (err) => {
        console.error("[figma/import] unhandled:", err);
        try {
            await cleanupFailedImport(prisma, args.importId, asError(err));
        } catch {
            /* ignore — DB might be transiently unavailable */
        }
    });
}

/**
 * Flip the FigmaImport to FAILED and best-effort remove any half-built Project
 * that would otherwise linger in the dashboard. Asset rows attached via
 * `downloadAssetsForFrames` will cascade-delete with the Project (Asset has
 * `projectId` with onDelete Cascade in the existing schema).
 */
async function cleanupFailedImport(
    prisma: PrismaClient,
    importId: string,
    errorMessage: string,
): Promise<void> {
    const row = await prisma.figmaImport.findUnique({
        where: { id: importId },
        select: { projectId: true, status: true },
    });

    if (row?.projectId) {
        try {
            // Mirror the router's cleanup: collect S3 keys for Assets + canvasState
            // before the cascade-delete removes their DB rows.
            const [assets, project] = await Promise.all([
                prisma.asset.findMany({
                    where: { projectId: row.projectId },
                    select: { url: true },
                }),
                prisma.project.findUnique({
                    where: { id: row.projectId },
                    select: { canvasState: true },
                }),
            ]);
            const s3Keys = [
                ...collectS3KeysFromAssets(assets),
                ...collectS3KeysFromCanvasState(project?.canvasState ?? null),
            ];
            if (s3Keys.length > 0) {
                await deleteS3Objects(s3Keys).catch((s3Err) =>
                    console.error("[figma/import] S3 cleanup failed:", s3Err),
                );
            }
            await prisma.project.delete({ where: { id: row.projectId } });
        } catch (deleteErr) {
            console.error("[figma/import] orphan project cleanup failed:", deleteErr);
        }
    }

    await prisma.figmaImport.update({
        where: { id: importId },
        data: {
            status: "FAILED",
            error: errorMessage.slice(0, 2000),
            progress: 100,
            projectId: null,
        },
    });
}

// ─── Implementation ─────────────────────────────────────────────────────────

async function runImport(args: StartImportArgs, prisma: PrismaClient): Promise<void> {
    const { importId, userId, workspaceId, fileKey, nodeId, projectName, options } = args;

    await update(prisma, importId, { status: "FETCHING", progress: 5 });

    const client = createFigmaClientForUser(userId);

    // ── 1. Fetch the full document tree ─────────────────────────────────────
    const fileResp = await client.getFile(fileKey);
    await update(prisma, importId, {
        status: "MAPPING",
        progress: 20,
        fileName: fileResp.name,
    });

    // ── 2. Map Figma nodes to Layers ────────────────────────────────────────
    let mapResult: MapperResult;
    if (nodeId) {
        // Narrow the document to the selected subtree by creating a synthetic
        // document that contains only that branch, keeping the mapper pure.
        const target = findNodeById(fileResp.document, nodeId);
        if (!target) {
            throw new Error(`Node ${nodeId} not found in file`);
        }
        // Wrap the target in a synthetic page so the mapper can treat it as a
        // normal top-level frame.
        const syntheticDoc = {
            ...fileResp.document,
            children: [
                {
                    id: "synthetic-canvas",
                    name: fileResp.name,
                    type: "CANVAS" as const,
                    visible: true,
                    scrollBehavior: "SCROLLS" as const,
                    backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                    prototypeStartNodeID: null,
                    flowStartingPoints: [],
                    prototypeDevice: { type: "NONE" as const, rotation: "NONE" as const },
                    children: [target],
                },
            ],
        } as typeof fileResp.document;
        mapResult = mapFigmaDocument(syntheticDoc, fileResp.components, options);
    } else {
        mapResult = mapFigmaDocument(fileResp.document, fileResp.components, options);
    }

    const allFrames = mapResult.pages.flatMap((p) => p.frames);
    if (allFrames.length === 0) {
        // Throw so the outer `catch` runs the uniform cleanup path
        // (cleanupFailedImport). Early-return would leave the import FAILED
        // without cleaning up a half-created Project, except there isn't one
        // yet on this path — but keeping the control flow uniform avoids
        // regressions if we later move Project creation above this check.
        throw new Error(
            "В Figma-файле не найдено фреймов — файл пустой или выбранная нода не содержит экспортируемых фреймов.",
        );
    }

    // ── 3. Create the Project first (without images) so we can attribute Asset
    //      rows to it during the download step. CanvasState gets filled in later.
    await update(prisma, importId, { status: "CREATING_PROJECT", progress: 40 });
    const project = await prisma.project.create({
        data: {
            name: projectName ?? fileResp.name,
            goal: "banner",
            workspaceId,
            createdById: userId,
            status: "IN_PROGRESS",
        },
    });
    await update(prisma, importId, { projectId: project.id });

    // ── 4. Download assets (image fills + rendered vectors) ─────────────────
    await update(prisma, importId, { status: "DOWNLOADING_ASSETS", progress: 60 });
    const downloadReport = await downloadAssetsForFrames({
        client,
        prisma,
        fileKey,
        frames: allFrames,
        workspaceId,
        projectId: project.id,
        uploadedById: userId,
    });

    // Apply downloaded URLs onto the mapped layers.
    for (const frame of allFrames) {
        for (const layer of frame.layers) {
            const url = downloadReport.layerUrls[layer.id];
            if (url && layer.type === "image") {
                layer.src = url;
            }
        }
    }

    // ── 5. Build CanvasState and persist onto the Project ───────────────────
    // MF-3: bump `version` so any editor tab already holding this project open
    // detects the import on its next saveState attempt and refetches instead
    // of silently overwriting the imported scene.
    const canvasState = buildCanvasState(allFrames);
    await prisma.project.update({
        where: { id: project.id },
        data: {
            canvasState: canvasState as unknown as Prisma.InputJsonValue,
            version: { increment: 1 },
        },
    });

    // ── 6. Finalise the report ──────────────────────────────────────────────
    const report: ImportReport = mergeStats(mapResult.report, downloadReport);

    await update(prisma, importId, {
        status: "COMPLETED",
        progress: 100,
        report: report as unknown as Prisma.InputJsonValue,
    });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function update(
    prisma: PrismaClient,
    importId: string,
    data: Prisma.FigmaImportUncheckedUpdateInput,
): Promise<void> {
    await prisma.figmaImport.update({ where: { id: importId }, data });
}

function mergeStats(report: ImportReport, download: { imagesDownloaded: number; imagesFailed: number }): ImportReport {
    return {
        ...report,
        stats: {
            ...report.stats,
            imagesDownloaded: download.imagesDownloaded,
            imagesFailed: download.imagesFailed,
        },
    };
}

function asError(err: unknown): string {
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

// ─── CanvasState synthesis ─────────────────────────────────────────────────

/**
 * Produce a `CanvasState` suitable for persistence into `Project.canvasState`.
 * Each top-level Figma frame becomes a separate `ResizeFormat` and contributes
 * its own `layerSnapshot`, preserving per-format independence.
 */
function buildCanvasState(
    frames: Array<{ figmaNodeId: string; name: string; width: number; height: number; layers: Layer[] }>,
): CanvasState {
    // First frame = master. Every frame is a resize.
    // NB: Figma node ids look like "2:0" — the colon is unsafe in URLs, JSON
    // keys, and CSS selectors downstream, so we collapse `:`/`.` into `-`.
    const resizes: ResizeFormat[] = frames.map((f, idx) => ({
        id: idx === 0 ? "master" : `figma-${f.figmaNodeId.replace(/[:.]/g, "-")}`,
        name: f.name,
        width: f.width,
        height: f.height,
        label: `${f.width} × ${f.height}`,
        instancesEnabled: idx !== 0,
        isMaster: idx === 0,
        layerSnapshot: f.layers,
    }));

    // For the master format we also seed `layers` + canvasWidth/Height so the
    // editor can open it without touching resizes.
    const masterFrame = frames[0];
    const artboardProps: ArtboardProps = {
        fill: "#ffffff",
        cornerRadius: 0,
        clipContent: true,
        stroke: "#000000",
        strokeWidth: 0,
    };
    return {
        layers: masterFrame.layers,
        masterComponents: [],
        componentInstances: [],
        resizes,
        artboardProps,
        canvasWidth: masterFrame.width,
        canvasHeight: masterFrame.height,
    };
}

// Expose for tests
export const __internals = {
    buildCanvasState,
    mergeStats,
    emptyReport,
};
