import { NextRequest, NextResponse } from "next/server";
import { getProvider, getModelById, generateWithFallback } from "@/lib/ai-providers";
import { getModelById as getModelEntryById } from "@/lib/ai-models";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { action, prompt, imageBase64, maskBase64, model, aspectRatio, canvasSize, originalSize, originalLocation, referenceImages, projectId } = body;

        if (!action) {
            return NextResponse.json(
                { error: "Action is required (remove-bg, inpaint, text-edit, outpaint, generate)" },
                { status: 400 }
            );
        }

        let result;
        let usedModel = model || "nano-banana-2"; // Track which model was actually used

        switch (action) {
            case "remove-bg": {
                // Always use rembg via Replicate, regardless of selected model
                usedModel = "rembg";
                const provider = getProvider("rembg");
                result = await provider.generate({
                    prompt: "",
                    type: "remove-bg",
                    model: "rembg",
                    imageBase64,
                });
                break;
            }

            case "inpaint": {
                // Use flux-fill or nano-banana models for inpainting
                const inpaintModel = model || "flux-fill";
                usedModel = inpaintModel;
                const provider = getProvider(inpaintModel);
                result = await provider.generate({
                    prompt: prompt || "Fill in the masked area naturally",
                    type: "inpainting",
                    model: inpaintModel,
                    imageBase64,
                    maskBase64,
                });
                break;
            }

            case "text-edit": {
                // Use models that support "edit" cap (nano-banana, flux-2-pro, gpt-image, seedream, qwen-image-edit)
                const editModel = model || "nano-banana-2";
                usedModel = editModel;
                const entry = getModelById(editModel);
                const supportsEdit = entry?.caps.includes("edit");

                if (supportsEdit) {
                    // Native image editing: pass image + text prompt → modified image
                    const provider = getProvider(editModel);
                    result = await provider.generate({
                        prompt: prompt || "Edit this image",
                        type: "edit",
                        model: editModel,
                        imageBase64,
                        aspectRatio,
                        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
                    });
                } else {
                    // Fallback: text-to-image with prompt (no editing, just regenerate)
                    const provider = getProvider(editModel);
                    result = await provider.generate({
                        prompt: prompt || "Generate an image",
                        type: "image",
                        model: editModel,
                        referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
                    });
                }
                break;
            }

            case "outpaint": {
                const outpaintModel = model || "bria-expand";
                usedModel = outpaintModel;
                const provider = getProvider(outpaintModel);
                result = await provider.generate({
                    prompt: prompt || "",
                    type: "outpainting",
                    model: outpaintModel,
                    imageBase64,
                    aspectRatio,
                    canvasSize,
                    originalSize,
                    originalLocation
                });
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
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        // ── Track AI cost ──────────────────────────────────────────
        try {
            const modelEntry = getModelEntryById(usedModel);
            const costPerRun = modelEntry?.costPerRun ?? 0;
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
        });

    } catch (error: unknown) {
        const err = error as Error;
        console.error("Image Edit API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
