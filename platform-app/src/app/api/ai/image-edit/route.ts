import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-providers";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, prompt, imageBase64, maskBase64, model } = body;

        if (!action) {
            return NextResponse.json(
                { error: "Action is required (remove-bg, inpaint, text-edit, generate)" },
                { status: 400 }
            );
        }

        let result;

        switch (action) {
            case "remove-bg": {
                // Use dedicated rembg model on Replicate
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
                // Use flux-fill for inpainting
                const provider = getProvider(model || "flux-fill");
                result = await provider.generate({
                    prompt: prompt || "Fill in the masked area naturally",
                    type: "inpainting",
                    model: model || "flux-fill",
                    imageBase64,
                    maskBase64,
                });
                break;
            }

            case "text-edit": {
                // Use an image model to re-generate based on prompt + source image
                // For now we use flux-dev which can take image input
                const provider = getProvider(model || "flux-dev");
                result = await provider.generate({
                    prompt: prompt || "Edit this image",
                    type: "image",
                    model: model || "flux-dev",
                    referenceImages: imageBase64 ? [imageBase64] : undefined,
                });
                break;
            }

            case "generate": {
                const provider = getProvider(model || "flux-schnell");
                result = await provider.generate({
                    prompt: prompt || "Generate an image",
                    type: "image",
                    model: model || "flux-schnell",
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
