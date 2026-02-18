import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-providers";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { prompt, type, model, params } = body;

        if (!prompt) {
            return NextResponse.json(
                { error: "Prompt is required" },
                { status: 400 }
            );
        }

        // Determine provider based on model or default
        // We treat 'model' field as the provider selector for now
        // e.g. model="flux" -> Flux Provider
        const providerId = model || "openai";
        const provider = getProvider(providerId);

        if (!provider) {
            return NextResponse.json(
                { error: `Provider not found for model: ${model}` },
                { status: 400 }
            );
        }

        const result = await provider.generate({
            prompt,
            type: type || "text",
            model: model,
            ...params,
        });

        return NextResponse.json(result);

    } catch (error: any) {
        console.error("AI Generation API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
