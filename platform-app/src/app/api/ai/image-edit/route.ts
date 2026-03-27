import { NextRequest, NextResponse } from "next/server";
import { getProvider, getModelById } from "@/lib/ai-providers";
import { auth } from "@/server/auth";

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { action, prompt, imageBase64, maskBase64, model, aspectRatio, canvasSize, originalSize, originalLocation } = body;

        if (!action) {
            return NextResponse.json(
                { error: "Action is required (remove-bg, inpaint, text-edit, outpaint, generate)" },
                { status: 400 }
            );
        }

        let result;

        switch (action) {
            case "remove-bg": {
                // Always use rembg via Replicate, regardless of selected model
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
                    });
                } else {
                    // Fallback: text-to-image with prompt (no editing, just regenerate)
                    const provider = getProvider(editModel);
                    result = await provider.generate({
                        prompt: prompt || "Generate an image",
                        type: "image",
                        model: editModel,
                    });
                }
                break;
            }

            case "outpaint": {
                const outpaintModel = model || "bria-expand";
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
