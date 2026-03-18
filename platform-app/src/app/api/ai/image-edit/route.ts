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

        // Route to appropriate provider based on action
        let providerId: string;
        let type: string;

        switch (action) {
            case "remove-bg":
                // For remove-bg we use a dedicated provider or OpenAI with specific prompt
                providerId = model || "openai";
                type = "inpainting";
                break;
            case "inpaint":
                providerId = model || "flux-fill";
                type = "inpainting";
                break;
            case "text-edit":
                providerId = model || "openai";
                type = "image";
                break;
            case "generate":
                providerId = model || "openai";
                type = "image";
                break;
            default:
                return NextResponse.json(
                    { error: `Unknown action: ${action}` },
                    { status: 400 }
                );
        }

        const provider = getProvider(providerId);

        if (!provider) {
            return NextResponse.json(
                { error: `Provider not found for model: ${providerId}` },
                { status: 400 }
            );
        }

        const editPrompt = action === "remove-bg"
            ? "Remove the background from this image, keep only the main subject on a transparent background"
            : prompt || "Edit this image";

        const result = await provider.generate({
            prompt: editPrompt,
            type: type as any,
            model: providerId,
            imageBase64,
            maskBase64,
        });

        return NextResponse.json({
            content: result.content,
            format: result.format,
            action,
            model: result.model,
            provider: result.provider,
        });

    } catch (error: any) {
        console.error("Image Edit API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
