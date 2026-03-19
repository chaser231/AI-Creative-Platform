import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-providers";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { prompt, type, model, width, height, count, seed, scale, referenceImages } = body;

        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
        }

        const provider = getProvider(model || "openai");

        const result = await provider.generate({
            prompt,
            type: type || "image",
            model,
            width,
            height,
            count,
            seed,
            scale,
            referenceImages,
        });

        return NextResponse.json(result);

    } catch (error: unknown) {
        const err = error as Error;
        console.error("AI Generation API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
