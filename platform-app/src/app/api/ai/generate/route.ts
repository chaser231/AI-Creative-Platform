import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-providers";
import { auth } from "@/server/auth";

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            prompt, type, model,
            aspectRatio, count, seed, scale,
            referenceImages, systemPrompt,
            imageBase64,
        } = body;

        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
        }

        // Debug: confirm referenceImages arrive at the route
        if (referenceImages && referenceImages.length > 0) {
            console.log(`[/api/ai/generate] referenceImages: ${referenceImages.length} image(s), first ~80 chars: ${String(referenceImages[0]).slice(0, 80)}`);
        }

        const provider = getProvider(model || "nano-banana-2");

        const result = await provider.generate({
            prompt,
            type: type || "image",
            model,
            aspectRatio,
            count,
            seed,
            scale,
            referenceImages,
            systemPrompt,
            imageBase64,
        });

        return NextResponse.json(result);

    } catch (error: unknown) {
        const err = error as Error;
        console.error("AI Generation API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
