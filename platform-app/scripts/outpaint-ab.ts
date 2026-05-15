/**
 * Outpaint A/B Harness
 *
 * Dev-time tool that runs a fixed set of reference images through several
 * outpaint pipeline configurations side by side, saving outputs and an HTML
 * gallery for manual visual review. The whole production pipeline (src/utils/
 * outpaintPipeline.ts + src/utils/imageComposite.ts) lives in the browser
 * because it uses HTMLCanvasElement/Image. Here we replicate the bits we need
 * server-side using sharp + raw fetch calls to fal.ai's queue endpoints.
 *
 * The harness deliberately FORCES the preserve pipeline (downscale → outpaint
 * → upscale → composite) by capping the per-side intermediate dimension at
 * HARNESS_MAX_FINAL_DIMENSION below. Production caps at 4800 which would skip
 * the upscale step for typical banner-sized references, leaving the seedvr
 * vs topaz-hf-v2 toggle indistinguishable in the gallery.
 *
 * Usage: see scripts/outpaint-ab/README.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// ─── Env + paths ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
        console.error(`Missing required env var: ${name}. See scripts/outpaint-ab/README.md.`);
        process.exit(1);
    }
    return v;
}

const FAL_KEY = requireEnv("FAL_KEY");

const OUT_DIR = path.resolve(process.cwd(), "tmp/outpaint-ab");
const INPUTS_DIR = path.join(OUT_DIR, "inputs");
const REFS_PATH = path.resolve(process.cwd(), "scripts/outpaint-ab/reference-images.json");

/**
 * Cap on the longest side of the intermediate image that goes into the
 * outpaint API call. When the natural final size exceeds this, the harness
 * downscales the base image (matching production's preserve pipeline path)
 * which forces the upscale + composite stages to actually run. Pick a value
 * small enough that every reasonable reference image will trip it.
 */
const HARNESS_MAX_FINAL_DIMENSION = 1500;

/** Hard per-side cap for flux-2-pro-outpaint (model limit, 2026-05). */
const FLUX2_PER_SIDE_CAP = 2048;

// ─── Types ──────────────────────────────────────────────────────────────────

interface PadSides {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface ReferenceImage {
    id: string;
    /** URL (https://…), data URI, or file:// path. */
    url: string;
    pad: PadSides;
    note?: string;
}

interface PipelineConfig {
    id: string;
    outpaintModel: "bria-expand" | "flux-2-pro-outpaint";
    upscaleModel: "seedvr" | "topaz-hf-v2";
    featherComposite: boolean;
}

interface RunOutput {
    refId: string;
    cfgId: string;
    outFile: string;
    ok: boolean;
    durationMs: number;
    error?: string;
}

const CONFIGS: PipelineConfig[] = [
    { id: "baseline",     outpaintModel: "bria-expand",         upscaleModel: "seedvr",      featherComposite: false },
    { id: "flux-only",    outpaintModel: "flux-2-pro-outpaint", upscaleModel: "seedvr",      featherComposite: false },
    { id: "feather-only", outpaintModel: "bria-expand",         upscaleModel: "seedvr",      featherComposite: true  },
    { id: "topaz-only",   outpaintModel: "bria-expand",         upscaleModel: "topaz-hf-v2", featherComposite: false },
    { id: "full-stack",   outpaintModel: "flux-2-pro-outpaint", upscaleModel: "topaz-hf-v2", featherComposite: true  },
];

const FAL_ENDPOINTS: Record<string, string> = {
    "bria-expand":         "fal-ai/bria/expand",
    "flux-2-pro-outpaint": "fal-ai/flux-2-pro/outpaint",
    "seedvr":              "fal-ai/seedvr/upscale/image",
    "topaz-hf-v2":         "fal-ai/topaz/upscale/image",
};

// ─── fal.ai REST client ─────────────────────────────────────────────────────
// Mirrors the queue submit-and-poll pattern in src/lib/ai-providers.ts so the
// harness exercises the same code path the production server hits.

interface FalSubmitResponse {
    request_id?: string;
    status_url?: string;
    response_url?: string;
    image?: { url?: string };
    images?: { url?: string }[];
}

interface FalStatusResponse {
    status: string;
}

interface FalResultResponse {
    image?: { url?: string };
    images?: { url?: string }[];
}

async function falSubmitAndPoll(
    endpoint: string,
    input: Record<string, unknown>,
    label: string,
): Promise<string> {
    const submitRes = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
            "Authorization": `Key ${FAL_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });
    if (!submitRes.ok) {
        const errBody = await submitRes.text();
        throw new Error(`fal.ai ${label} submit failed (${submitRes.status}): ${errBody.slice(0, 300)}`);
    }
    const submit = (await submitRes.json()) as FalSubmitResponse;

    if (!submit.request_id) {
        const url = submit.images?.[0]?.url ?? submit.image?.url;
        if (!url) throw new Error(`fal.ai ${label} returned no image (sync)`);
        return url;
    }

    const statusUrl = submit.status_url
        || `https://queue.fal.run/${endpoint}/requests/${submit.request_id}/status`;
    const responseUrl = submit.response_url
        || `https://queue.fal.run/${endpoint}/requests/${submit.request_id}`;

    let lastStatus = "IN_PROGRESS";
    for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const statusRes = await fetch(statusUrl, {
                headers: { "Authorization": `Key ${FAL_KEY}` },
            });
            if (!statusRes.ok) continue;
            const status = (await statusRes.json()) as FalStatusResponse;
            lastStatus = status.status;
            if (status.status === "COMPLETED") break;
            if (status.status === "FAILED") {
                throw new Error(`fal.ai ${label} generation failed`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof TypeError && msg.includes("fetch")) continue;
            throw err;
        }
    }
    if (lastStatus !== "COMPLETED") {
        throw new Error(`fal.ai ${label} timed out after 300s (last status: ${lastStatus})`);
    }

    const resultRes = await fetch(responseUrl, {
        headers: { "Authorization": `Key ${FAL_KEY}` },
    });
    if (!resultRes.ok) {
        throw new Error(`fal.ai ${label} result fetch failed (${resultRes.status})`);
    }
    const result = (await resultRes.json()) as FalResultResponse;
    const url = result.images?.[0]?.url ?? result.image?.url;
    if (!url) throw new Error(`fal.ai ${label} returned no image (queued)`);
    return url;
}

// ─── I/O helpers ────────────────────────────────────────────────────────────

async function downloadImage(src: string): Promise<Buffer> {
    if (src.startsWith("data:")) {
        const comma = src.indexOf(",");
        if (comma === -1) throw new Error("Malformed data URI");
        const isBase64 = src.slice(0, comma).includes(";base64");
        const payload = src.slice(comma + 1);
        return Buffer.from(payload, isBase64 ? "base64" : "utf-8");
    }
    if (src.startsWith("file://")) {
        return fs.readFile(new URL(src));
    }
    const res = await fetch(src);
    if (!res.ok) {
        throw new Error(`Download failed (${res.status}) for ${src.slice(0, 80)}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

function bufferToDataUri(buf: Buffer, mime = "image/png"): string {
    return `data:${mime};base64,${buf.toString("base64")}`;
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.stat(p);
        return true;
    } catch {
        return false;
    }
}

// ─── Feather mask (1:1 port of src/utils/imageComposite.ts) ─────────────────

function clampFeatherPx(width: number, height: number, featherPx: number): number {
    const maxFeather = Math.floor((Math.min(width, height) - 1) / 2);
    return Math.max(0, Math.min(featherPx, maxFeather));
}

function computeFeatherPx(origW: number, origH: number): number {
    return Math.round(Math.max(24, Math.min(64, Math.min(origW, origH) * 0.04)));
}

function featherAlphaAt(
    x: number,
    y: number,
    width: number,
    height: number,
    pad: PadSides,
    featherPx: number,
): number {
    if (featherPx <= 0) return 255;
    let factor = 1;
    if (pad.top > 0 && y < featherPx) factor *= y / featherPx;
    if (pad.bottom > 0) {
        const d = height - 1 - y;
        if (d < featherPx) factor *= d / featherPx;
    }
    if (pad.left > 0 && x < featherPx) factor *= x / featherPx;
    if (pad.right > 0) {
        const d = width - 1 - x;
        if (d < featherPx) factor *= d / featherPx;
    }
    if (factor <= 0) return 0;
    if (factor >= 1) return 255;
    return Math.round(factor * 255);
}

function buildFeatherMaskRGBA(
    width: number,
    height: number,
    pad: PadSides,
    featherPx: number,
): Buffer {
    const clamped = clampFeatherPx(width, height, featherPx);
    const buf = Buffer.alloc(width * height * 4);
    // R/G/B stay 0 — only the alpha channel drives the dest-in blend.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            buf[i + 3] = featherAlphaAt(x, y, width, height, pad, clamped);
        }
    }
    return buf;
}

// ─── Composite (Node port of compositeExpandResult) ─────────────────────────
// Skips the colour-match nudge from the browser pipeline; the feather alone
// covers ~90% of the visual gain and the colour shift adds significant
// complexity (sample → diff → shift) that isn't needed for an A/B harness.

async function composite(opts: {
    expandedBuf: Buffer;
    originalBuf: Buffer;
    pad: PadSides;
    feather: boolean;
}): Promise<Buffer> {
    const { expandedBuf, originalBuf, pad, feather } = opts;

    const origMeta = await sharp(originalBuf).metadata();
    const origW = origMeta.width;
    const origH = origMeta.height;
    if (!origW || !origH) throw new Error("composite: original missing dimensions");

    const canvasW = Math.round(origW + pad.left + pad.right);
    const canvasH = Math.round(origH + pad.top + pad.bottom);
    const destX = Math.round(pad.left);
    const destY = Math.round(pad.top);

    // The expanded result frequently arrives a few pixels off the final
    // canvas (upscalers round up); resize to exact fit so the composite
    // lands pixel-aligned.
    const expandedFit = await sharp(expandedBuf)
        .resize({ width: canvasW, height: canvasH, fit: "fill" })
        .png()
        .toBuffer();

    const hasPad = pad.top > 0 || pad.right > 0 || pad.bottom > 0 || pad.left > 0;

    if (!hasPad || !feather) {
        // Hard composite: paste the original on top with no blending. Used
        // for the baseline configs to reproduce the legacy seam behaviour.
        const overlay = await sharp(originalBuf).ensureAlpha().png().toBuffer();
        return sharp(expandedFit)
            .composite([{ input: overlay, top: destY, left: destX }])
            .png()
            .toBuffer();
    }

    const featherPx = computeFeatherPx(origW, origH);
    const maskBuf = buildFeatherMaskRGBA(origW, origH, pad, featherPx);
    const maskPng = await sharp(maskBuf, {
        raw: { width: origW, height: origH, channels: 4 },
    })
        .png()
        .toBuffer();

    const featheredOriginal = await sharp(originalBuf)
        .ensureAlpha()
        .composite([{ input: maskPng, blend: "dest-in" }])
        .png()
        .toBuffer();

    return sharp(expandedFit)
        .composite([{ input: featheredOriginal, top: destY, left: destX }])
        .png()
        .toBuffer();
}

// ─── Outpaint + upscale wrappers ────────────────────────────────────────────

async function runOutpaint(
    imageDataUri: string,
    pad: PadSides,
    origW: number,
    origH: number,
    model: PipelineConfig["outpaintModel"],
): Promise<string> {
    const endpoint = FAL_ENDPOINTS[model];

    if (model === "flux-2-pro-outpaint") {
        const maxSide = Math.max(pad.top, pad.right, pad.bottom, pad.left);
        if (maxSide > FLUX2_PER_SIDE_CAP) {
            // Production has a multipass orchestrator (Phase 5) that splits
            // requests over the cap; the harness keeps configs side-by-side
            // comparable by demanding a single call per config and erroring
            // out instead of silently downgrading.
            throw new Error(
                `flux-2-pro-outpaint: pad ${maxSide}px exceeds cap ${FLUX2_PER_SIDE_CAP}px. Reduce pad in reference-images.json or omit this config for this image.`,
            );
        }
    }

    const input: Record<string, unknown> = {
        image_url: imageDataUri,
    };
    if (model === "flux-2-pro-outpaint") {
        input.expand_top    = Math.round(pad.top);
        input.expand_bottom = Math.round(pad.bottom);
        input.expand_left   = Math.round(pad.left);
        input.expand_right  = Math.round(pad.right);
        input.output_format = "png";
        input.auto_crop = false;
    } else {
        input.prompt = "Fill seamlessly";
        input.canvas_size = [
            Math.round(origW + pad.left + pad.right),
            Math.round(origH + pad.top + pad.bottom),
        ];
        input.original_image_location = [Math.round(pad.left), Math.round(pad.top)];
        input.original_image_size = [Math.round(origW), Math.round(origH)];
    }

    return falSubmitAndPoll(endpoint, input, `outpaint:${model}`);
}

async function runUpscale(
    imageDataUri: string,
    scale: number,
    model: PipelineConfig["upscaleModel"],
): Promise<string> {
    const endpoint = FAL_ENDPOINTS[model];
    const input: Record<string, unknown> = {
        image_url: imageDataUri,
        output_format: "png",
    };
    if (model === "seedvr") {
        input.upscale_factor = Math.min(Math.max(scale, 1), 10);
        input.upscale_mode = "factor";
    } else {
        // topaz-hf-v2 — pin to High Fidelity V2 with face_enhancement off, matching
        // the production wiring in src/lib/ai-providers.ts.
        input.model = "High Fidelity V2";
        input.upscale_factor = Math.min(Math.max(scale, 1), 4);
        input.face_enhancement = false;
    }
    return falSubmitAndPoll(endpoint, input, `upscale:${model}`);
}

// ─── Per-config pipeline ────────────────────────────────────────────────────

async function runConfig(
    ref: ReferenceImage,
    cfg: PipelineConfig,
    originalBuf: Buffer,
): Promise<Buffer> {
    const origMeta = await sharp(originalBuf).metadata();
    const origW = origMeta.width;
    const origH = origMeta.height;
    if (!origW || !origH) throw new Error("Missing source dimensions");

    const pad = ref.pad;
    const finalW = origW + pad.left + pad.right;
    const finalH = origH + pad.top + pad.bottom;

    let baseBuf = originalBuf;
    let scaledPad = pad;
    let baseW = origW;
    let baseH = origH;
    let downscaleRatio = 1;

    // Downscale step — matches production's preserve pipeline, but at a
    // tighter dimension cap so the upscale + composite stages always run.
    if (finalW > HARNESS_MAX_FINAL_DIMENSION || finalH > HARNESS_MAX_FINAL_DIMENSION) {
        downscaleRatio = Math.min(
            HARNESS_MAX_FINAL_DIMENSION / finalW,
            HARNESS_MAX_FINAL_DIMENSION / finalH,
        );
        baseW = Math.round(origW * downscaleRatio);
        baseH = Math.round(origH * downscaleRatio);
        scaledPad = {
            top:    Math.round(pad.top * downscaleRatio),
            right:  Math.round(pad.right * downscaleRatio),
            bottom: Math.round(pad.bottom * downscaleRatio),
            left:   Math.round(pad.left * downscaleRatio),
        };
        baseBuf = await sharp(originalBuf)
            .resize({ width: baseW, height: baseH, fit: "fill" })
            .png()
            .toBuffer();
    }

    const baseDataUri = bufferToDataUri(baseBuf);
    const outpaintUrl = await runOutpaint(baseDataUri, scaledPad, baseW, baseH, cfg.outpaintModel);
    let resultBuf = await downloadImage(outpaintUrl);

    if (downscaleRatio < 1) {
        // Upscale back to (near) native resolution, then composite the
        // original on top with the chosen blend mode.
        const upscaleScale = Math.min(Math.ceil(1 / downscaleRatio), 4);
        const outpaintDataUri = bufferToDataUri(resultBuf);
        const upscaledUrl = await runUpscale(outpaintDataUri, upscaleScale, cfg.upscaleModel);
        const upscaledBuf = await downloadImage(upscaledUrl);
        resultBuf = await composite({
            expandedBuf: upscaledBuf,
            originalBuf,
            pad,
            feather: cfg.featherComposite,
        });
    } else {
        // No downscale → upscale stage was skipped, so the upscaleModel
        // choice doesn't impact output. Still run the composite so the
        // hard-vs-feather toggle stays visible in the gallery.
        resultBuf = await composite({
            expandedBuf: resultBuf,
            originalBuf,
            pad,
            feather: cfg.featherComposite,
        });
    }

    return resultBuf;
}

// ─── HTML gallery ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function generateGalleryHtml(refs: ReferenceImage[], runs: RunOutput[]): string {
    const byRef = new Map<string, Map<string, RunOutput>>();
    for (const run of runs) {
        const m = byRef.get(run.refId) ?? new Map<string, RunOutput>();
        m.set(run.cfgId, run);
        byRef.set(run.refId, m);
    }

    const headerCells = CONFIGS.map((c) => {
        const desc = `${c.outpaintModel} → ${c.upscaleModel}${c.featherComposite ? " + feather" : ""}`;
        return `<th>${escapeHtml(c.id)}<br><span class="meta">${escapeHtml(desc)}</span></th>`;
    }).join("");

    const rows = refs
        .map((ref) => {
            const cells = CONFIGS.map((cfg) => {
                const run = byRef.get(ref.id)?.get(cfg.id);
                if (!run) return `<td class="missing">—</td>`;
                if (!run.ok) {
                    return `<td class="failed"><strong>FAILED</strong><br><span class="meta">${escapeHtml(run.error ?? "")}</span></td>`;
                }
                const rel = path.relative(OUT_DIR, run.outFile);
                const timing = run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : "cached";
                return `<td><a href="${escapeHtml(rel)}" target="_blank"><img src="${escapeHtml(rel)}" loading="lazy" /></a><br><span class="meta">${escapeHtml(timing)}</span></td>`;
            }).join("");

            const inputRel = path.relative(OUT_DIR, path.join(INPUTS_DIR, `${ref.id}.png`));
            const noteLine = ref.note ? `<br><span class="meta">${escapeHtml(ref.note)}</span>` : "";
            const padLine = `pad ${ref.pad.top}/${ref.pad.right}/${ref.pad.bottom}/${ref.pad.left}`;
            return `<tr><th class="ref"><div><strong>${escapeHtml(ref.id)}</strong>${noteLine}<br><span class="meta">${escapeHtml(padLine)}</span></div><a href="${escapeHtml(inputRel)}" target="_blank"><img src="${escapeHtml(inputRel)}" loading="lazy" /></a></th>${cells}</tr>`;
        })
        .join("\n");

    const totalMs = runs.reduce((s, r) => s + r.durationMs, 0);
    const okCount = runs.filter((r) => r.ok).length;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Outpaint A/B Gallery</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 16px; background: #111; color: #ddd; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 6px; vertical-align: top; text-align: left; }
  th { background: #181818; }
  th.ref { width: 260px; }
  img { max-width: 320px; height: auto; display: block; background: #000; margin-top: 4px; }
  .meta { color: #888; font-size: 11px; }
  .failed { background: #401414; color: #f88; }
  .missing { color: #555; text-align: center; }
  .summary { margin-bottom: 16px; color: #aaa; font-size: 12px; }
  a { color: inherit; text-decoration: none; }
</style>
</head>
<body>
<h1>Outpaint A/B Gallery</h1>
<div class="summary">
  ${refs.length} refs × ${CONFIGS.length} configs = ${refs.length * CONFIGS.length} runs.
  Completed: ${okCount}/${runs.length}. Total wall time: ${(totalMs / 1000).toFixed(1)}s.
  HARNESS_MAX_FINAL_DIMENSION = ${HARNESS_MAX_FINAL_DIMENSION}px (forces preserve pipeline; see README).
</div>
<table>
  <thead><tr><th class="ref">Reference</th>${headerCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const raw = await fs.readFile(REFS_PATH, "utf8");
    const refs = JSON.parse(raw) as ReferenceImage[];
    if (!Array.isArray(refs) || refs.length === 0) {
        throw new Error(`No reference images in ${REFS_PATH}`);
    }

    await fs.mkdir(INPUTS_DIR, { recursive: true });

    const runs: RunOutput[] = [];

    for (const ref of refs) {
        const inputPath = path.join(INPUTS_DIR, `${ref.id}.png`);
        let originalBuf: Buffer | null = null;

        if (!(await fileExists(inputPath))) {
            try {
                console.log(`[${ref.id}] downloading reference from ${ref.url.slice(0, 80)}...`);
                const buf = await downloadImage(ref.url);
                // Normalise to PNG so every downstream stage speaks one format.
                const png = await sharp(buf).png().toBuffer();
                await fs.writeFile(inputPath, png);
                originalBuf = png;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[${ref.id}] failed to download (${msg}); skipping all configs.`);
                for (const cfg of CONFIGS) {
                    runs.push({
                        refId: ref.id,
                        cfgId: cfg.id,
                        outFile: path.join(OUT_DIR, `${ref.id}-${cfg.id}.png`),
                        ok: false,
                        durationMs: 0,
                        error: `Download failed: ${msg}`,
                    });
                }
                continue;
            }
        } else {
            originalBuf = await fs.readFile(inputPath);
        }

        for (const cfg of CONFIGS) {
            const out = path.join(OUT_DIR, `${ref.id}-${cfg.id}.png`);
            if (await fileExists(out)) {
                console.log(`[${ref.id} / ${cfg.id}] cached, skipping`);
                runs.push({
                    refId: ref.id,
                    cfgId: cfg.id,
                    outFile: out,
                    ok: true,
                    durationMs: 0,
                });
                continue;
            }

            const t0 = Date.now();
            console.log(`[${ref.id} / ${cfg.id}] outpaint=${cfg.outpaintModel}, upscale=${cfg.upscaleModel}, feather=${cfg.featherComposite} ...`);
            try {
                const buf = await runConfig(ref, cfg, originalBuf);
                await fs.writeFile(out, buf);
                const dt = Date.now() - t0;
                console.log(`[${ref.id} / ${cfg.id}] done in ${(dt / 1000).toFixed(1)}s → ${path.relative(process.cwd(), out)}`);
                runs.push({
                    refId: ref.id,
                    cfgId: cfg.id,
                    outFile: out,
                    ok: true,
                    durationMs: dt,
                });
            } catch (e) {
                const dt = Date.now() - t0;
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`[${ref.id} / ${cfg.id}] FAILED in ${(dt / 1000).toFixed(1)}s: ${msg}`);
                runs.push({
                    refId: ref.id,
                    cfgId: cfg.id,
                    outFile: out,
                    ok: false,
                    durationMs: dt,
                    error: msg,
                });
            }
        }
    }

    const html = generateGalleryHtml(refs, runs);
    const galleryPath = path.join(OUT_DIR, "gallery.html");
    await fs.writeFile(galleryPath, html);
    console.log(`\nGallery: file://${galleryPath}`);
}

main().catch((err: unknown) => {
    console.error("Fatal:", err);
    process.exit(1);
});
