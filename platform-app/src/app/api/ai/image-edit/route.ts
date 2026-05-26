import { NextRequest, NextResponse } from "next/server";
import { getProvider, getModelById, generateWithFallback } from "@/lib/ai-providers";
import { getModelById as getModelEntryById, estimateMegapixels } from "@/lib/ai-models";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { randomUUID } from "crypto";
import { buildInpaintPrompt, DEFAULT_INPAINT_MODEL, type InpaintIntent } from "@/lib/inpaintPrompts";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
        }

        const userId = session.user.id ?? "anon";
        const rl = checkRateLimit(`ai-edit:${userId}`, { limit: 20, windowSeconds: 60 });
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Слишком много запросов. Подождите минуту.", requestId, retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
                { status: 429 },
            );
        }

        const body = await req.json();
        const {
            action, prompt, imageBase64, maskBase64, model, aspectRatio,
            canvasSize, originalSize, originalLocation, referenceImages, projectId,
            expandPadding, upscaleScale, imageSize, recordMessage = true, scale,
            // LoRA-aware models accept these on edit endpoints too
            // (qwen-image-edit-lora, flux-lora/image-to-image).
            loras, guidanceScale, numInferenceSteps, negativePrompt, acceleration,
            // Inpaint surface — "edit" (default) appends the user prompt with
            // a per-model style hint; "remove" overrides the prompt with the
            // object-removal instruction. Anything else falls back to "edit".
            intent,
        } = body;

        if (!action) {
            return NextResponse.json(
                { error: "Action is required (remove-bg, inpaint, text-edit, outpaint, generate)", requestId },
                { status: 400 }
            );
        }

        console.log("[/api/ai/image-edit] request", {
            requestId,
            userId: session.user.id,
            action,
            model,
            projectId,
            hasMask: Boolean(maskBase64),
            hasPrompt: Boolean(prompt),
            hasReferenceImages: Array.isArray(referenceImages) && referenceImages.length > 0,
            aspectRatio,
            originalSize,
            expandPadding,
        });

        let result;
        let usedModel = model || "nano-banana-2"; // Track which model was actually used

        switch (action) {
            case "remove-bg": {
                // Use bria-rmbg via fal.ai (with fallback to rembg via Replicate)
                const rmbgModel = model || "bria-rmbg";
                usedModel = rmbgModel;
                result = await generateWithFallback({
                    prompt: "",
                    type: "remove-bg",
                    model: rmbgModel,
                    imageBase64,
                });
                if (result.model) usedModel = result.model;
                break;
            }

            case "inpaint": {
                // Default model: flux-fill (the only one with strict mask
                // support on both fal.ai and Replicate). generateWithFallback
                // routes fal → Replicate with retries and sibling-model
                // fallback (see MODEL_FALLBACK_CHAIN).
                const inpaintModel = model || DEFAULT_INPAINT_MODEL;
                usedModel = inpaintModel;

                // Build the actual provider prompt from user prompt + intent.
                // "remove" overrides whatever the user typed with the
                // standard object-removal instruction.
                const resolvedIntent: InpaintIntent =
                    intent === "remove" ? "remove" : "edit";
                const built = buildInpaintPrompt({
                    model: inpaintModel,
                    intent: resolvedIntent,
                    userPrompt: prompt,
                });

                console.log("[/api/ai/image-edit] inpaint", {
                    requestId,
                    model: inpaintModel,
                    intent: built.effectiveIntent,
                    promptPreview: built.prompt.slice(0, 80),
                });

                // Default scale to "high" for inpaint so gpt-image-* and
                // other quality-aware models stop generating low-res patches.
                // Caller can still override by passing scale explicitly.
                const resolvedScale = scale || "high";

                const inpaintStartedAt = Date.now();
                result = await generateWithFallback({
                    prompt: built.prompt,
                    type: "inpainting",
                    model: inpaintModel,
                    imageBase64,
                    maskBase64,
                    imageSize,
                    scale: resolvedScale,
                    // LoRA controls — only honored when the model has a loraSpec.
                    loras,
                    guidanceScale,
                    numInferenceSteps,
                    negativePrompt,
                    acceleration,
                });
                console.log("[/api/ai/image-edit] inpaint completed", {
                    requestId,
                    model: result.model ?? inpaintModel,
                    provider: result.provider,
                    durationMs: Date.now() - inpaintStartedAt,
                });
                if (result.model) usedModel = result.model;
                break;
            }

            case "text-edit": {
                // Use models that support "edit" cap (nano-banana, flux-2-pro, gpt-image, seedream, qwen-image-edit)
                // generateWithFallback tries fal.ai → Replicate with retries and model fallback chains
                const editModel = model || "nano-banana-2";
                usedModel = editModel;
                const entry = getModelById(editModel);
                const supportsEdit = entry?.caps.includes("edit");

                if (supportsEdit) {
                    // Native image editing: pass image + text prompt → modified image
                    result = await generateWithFallback({
                        prompt: prompt || "Edit this image",
                        type: "edit",
                        model: editModel,
                        imageBase64,
                        aspectRatio,
                        scale,
                        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
                        loras,
                        guidanceScale,
                        numInferenceSteps,
                        negativePrompt,
                        acceleration,
                    });
                } else {
                    // Fallback: text-to-image with prompt (no editing, just regenerate)
                    result = await generateWithFallback({
                        prompt: prompt || "Generate an image",
                        type: "image",
                        model: editModel,
                        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
                        loras,
                        guidanceScale,
                        numInferenceSteps,
                        negativePrompt,
                        acceleration,
                    });
                }
                if (result.model) usedModel = result.model;
                break;
            }

            case "outpaint": {
                // generateWithFallback tries fal.ai → Replicate with retries
                const outpaintModel = model || "bria-expand";
                usedModel = outpaintModel;
                result = await generateWithFallback({
                    prompt: prompt || "",
                    type: "outpainting",
                    model: outpaintModel,
                    imageBase64,
                    aspectRatio,
                    canvasSize,
                    originalSize,
                    originalLocation,
                    expandPadding,
                });
                if (result.model) usedModel = result.model;
                break;
            }

            case "upscale": {
                const upscaleModel = model || "seedvr";
                usedModel = upscaleModel;
                result = await generateWithFallback({
                    prompt: "",
                    type: "upscale",
                    model: upscaleModel,
                    imageBase64,
                    upscaleScale: upscaleScale ?? 2,
                });
                if (result.model) usedModel = result.model;
                break;
            }

            case "generate": {
                const genModel = model || "nano-banana-2";
                usedModel = genModel;
                const provider = getProvider(genModel);
                result = await provider.generate({
                    prompt: prompt || "Generate an image",
                    type: "image",
                    model: genModel,
                    aspectRatio,
                });
                break;
            }

            default:
                return NextResponse.json({ error: `Unknown action: ${action}`, requestId }, { status: 400 });
        }

        // ── Track AI cost ──────────────────────────────────────────
        // Skipped when caller opts out via `recordMessage: false`
        // (e.g. /photo workspace writes the AIMessage itself with the persisted S3 URL).
        try {
            if (!recordMessage) {
                return NextResponse.json({
                    content: result.content,
                    format: result.format,
                    action,
                    model: result.model,
                    provider: result.provider,
                    requestId,
                });
            }
            const modelEntry = getModelEntryById(usedModel);
            // LoRA-aware models bill per megapixel — multiply by an estimate
            // of the actually-generated image size. Plain models keep their
            // flat costPerRun.
            const costPerRun = modelEntry?.loraSpec
                ? modelEntry.loraSpec.pricePerMP
                    * estimateMegapixels(usedModel, undefined)
                : (modelEntry?.costPerRun ?? 0);
            const userId = session.user.id;

            if (projectId) {
                // Find or create an AI session for this project/user
                let aiSession = await prisma.aISession.findFirst({
                    where: { projectId, userId },
                    orderBy: { updatedAt: "desc" },
                    select: { id: true },
                });
                if (!aiSession) {
                    aiSession = await prisma.aISession.create({
                        data: { projectId, userId },
                    });
                }

                await prisma.aIMessage.create({
                    data: {
                        sessionId: aiSession.id,
                        role: "assistant",
                        content: `[${action}] ${prompt || action}`.slice(0, 200),
                        type: "image",
                        model: modelEntry?.id || usedModel,
                        costUnits: costPerRun,
                    },
                });
            }
        } catch (costErr) {
            console.error("[/api/ai/image-edit] Cost tracking failed:", costErr);
            // Non-blocking — don't fail the generation if tracking fails
        }

        return NextResponse.json({
            content: result.content,
            format: result.format,
            action,
            model: result.model,
            provider: result.provider,
            requestId,
        });

    } catch (error: unknown) {
        const err = error as Error;
        console.error("Image Edit API Error:", { requestId, error: err });
        return NextResponse.json({ error: err.message || "Internal Server Error", requestId }, { status: 500 });
    }
}
