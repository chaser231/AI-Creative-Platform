/**
 * Client-side workflow handlers — thin contracts for the Phase 4 executor.
 *
 * These are NOT invoked in Phase 3. They exist so Phase 4 can import them
 * with the same signature the planner committed to in 03-CONTEXT.md / D-17,
 * and so we can unit-test the per-node param resolution rules now without
 * waiting for the executor implementation.
 *
 * Why client-side instead of server actions:
 * - imageInput needs a URL the user already chose interactively (library
 *   pick or in-browser upload). The server has no extra info to add.
 * - assetOutput writes the workflow's final image to the workspace asset
 *   library. It's a thin wrapper around the existing asset.attachUrlToWorkspace
 *   tRPC mutation; the executor calls it from the browser to keep auth and
 *   billing accounting on the user's session.
 *
 * Phase 3, Wave 5 — D-17.
 */

import {
    assetOutputParamsSchema,
    imageInputParamsSchema,
    type AssetOutputParams,
    type ImageInputParams,
} from "@/lib/workflow/nodeParamSchemas";

/** Resolved output of an imageInput node — the executor pipes `.url` downstream. */
export interface ImageInputResult {
    url: string;
    /** Set only when the source was a library pick — null for raw URL or fresh upload. */
    assetId: string | null;
}

/** TRPC client surface the handlers depend on. Kept narrow for testability. */
export interface ClientHandlerDeps {
    /** trpc.asset.getById query — returns an asset row with at least { url }. */
    getAssetById: (input: { id: string }) => Promise<{ id: string; url: string }>;
    /** trpc.asset.attachUrlToWorkspace mutation — registers a final image. */
    attachUrlToWorkspace: (input: {
        workspaceId: string;
        url: string;
        filename?: string;
    }) => Promise<{ id: string }>;
}

/**
 * Resolve an imageInput node's params into a downstream URL.
 *
 * Validation is the executor's responsibility too (it must short-circuit the
 * whole graph if any node has invalid params), but we re-run safeParse here
 * so this contract is self-defending if a future caller forgets.
 */
export async function imageInput(
    rawParams: unknown,
    deps: ClientHandlerDeps,
): Promise<ImageInputResult> {
    const parsed = imageInputParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `imageInput: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }

    const params: ImageInputParams = parsed.data;

    if (params.source === "asset") {
        const asset = await deps.getAssetById({ id: params.assetId! });
        return { url: asset.url, assetId: asset.id };
    }

    return { url: params.sourceUrl!, assetId: null };
}

/** Resolved output of an assetOutput node — the executor surfaces this in the run summary. */
export interface AssetOutputResult {
    assetId: string;
    url: string;
    name: string;
}

/**
 * Persist the upstream image as a workspace-level Asset.
 *
 * Idempotency is enforced server-side by `attachUrlToWorkspace`
 * (workspaceId + url uniqueness, projectId null), so re-running the same
 * workflow with unchanged inputs reuses the existing library entry.
 */
export async function assetOutput(
    rawParams: unknown,
    upstreamUrl: string,
    workspaceId: string,
    deps: ClientHandlerDeps,
): Promise<AssetOutputResult> {
    const parsed = assetOutputParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
        throw new Error(
            `assetOutput: invalid params — ${parsed.error.issues
                .map((i) => i.message)
                .join("; ")}`,
        );
    }

    const params: AssetOutputParams = parsed.data;

    const created = await deps.attachUrlToWorkspace({
        workspaceId,
        url: upstreamUrl,
        filename: params.name,
    });

    return { assetId: created.id, url: upstreamUrl, name: params.name };
}
