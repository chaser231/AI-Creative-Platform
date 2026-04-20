/**
 * Internal types for the Figma integration (Phase 1 — Read-only Import).
 *
 * Keeps our internal contracts independent of the evolving `@figma/rest-api-spec`
 * types so that downstream callers don't have to depend on Figma's exact DTOs.
 */

// ─── Import options ─────────────────────────────────────────────────────────

export interface FigmaImportOptions {
    /**
     * If true, vector nodes (VECTOR, BOOLEAN_OPERATION, STAR, REGULAR_POLYGON,
     * LINE) are rasterized via `/v1/images?format=svg` and inserted as ImageLayer.
     * If false, they are skipped entirely (a warning is emitted).
     * @default true
     */
    preserveVectorsAsImages?: boolean;
    /**
     * If true, Figma text nodes whose characters carry mixed styles
     * (character-level font/colour overrides) will be flagged in the import
     * report but still imported using the node's primary style.
     * @default true
     */
    allowLossyText?: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: Required<FigmaImportOptions> = {
    preserveVectorsAsImages: true,
    allowLossyText: true,
};

// ─── Import report ──────────────────────────────────────────────────────────

export type LossyReason =
    | "gradient_fill_flattened"
    | "multiple_fills_flattened"
    | "effect_ignored"
    | "stroke_align_lost"
    | "baseline_align_lost"
    | "justified_text_lost"
    | "mixed_text_styles_collapsed"
    | "unsupported_text_decoration"
    | "unsupported_text_case"
    | "auto_layout_wrap_flattened"
    | "vector_rasterized"
    | "unsupported_node_type"
    | "image_fill_download_failed";

export interface ImportWarning {
    nodeId: string;
    nodeName: string;
    reason: LossyReason;
    message?: string;
}

export interface ImportReport {
    warnings: ImportWarning[];
    skippedNodes: Array<{ nodeId: string; nodeName: string; nodeType: string }>;
    stats: {
        pagesSeen: number;
        nodesSeen: number;
        layersCreated: number;
        mastersCreated: number;
        instancesCreated: number;
        imagesDownloaded: number;
        imagesFailed: number;
    };
}

export function emptyReport(): ImportReport {
    return {
        warnings: [],
        skippedNodes: [],
        stats: {
            pagesSeen: 0,
            nodesSeen: 0,
            layersCreated: 0,
            mastersCreated: 0,
            instancesCreated: 0,
            imagesDownloaded: 0,
            imagesFailed: 0,
        },
    };
}

// ─── Connection state ───────────────────────────────────────────────────────

export interface FigmaConnectionInfo {
    connected: boolean;
    figmaUserId?: string;
    figmaHandle?: string;
    figmaEmail?: string;
    expiresAt?: Date;
    scope?: string;
}

// ─── Import status (mirrors the Prisma enum string) ─────────────────────────

export type FigmaImportStatus =
    | "PENDING"
    | "FETCHING"
    | "MAPPING"
    | "DOWNLOADING_ASSETS"
    | "CREATING_PROJECT"
    | "COMPLETED"
    | "FAILED";
