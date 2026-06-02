/**
 * Resolves the active outpaint model id for client-side callers.
 *
 * Reads `NEXT_PUBLIC_OUTPAINT_MODEL` (baked at build time by Next.js) so
 * operators can flip the default without a code change — e.g. set it to
 * "bria-expand" in `.env.local` to instantly roll back to the previous
 * model if flux-2-pro-outpaint misbehaves in production.
 *
 * Default: "flux-2-pro-outpaint".
 */
export function getOutpaintModel(defaultModel = "flux-2-pro-outpaint"): string {
    const fromEnv = process.env.NEXT_PUBLIC_OUTPAINT_MODEL;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
    return defaultModel;
}
