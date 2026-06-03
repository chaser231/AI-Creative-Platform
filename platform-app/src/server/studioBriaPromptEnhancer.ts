import {
    buildStudioBriaVisionInstruction,
    extractFalVisionOutput,
    fallbackStudioBriaPromptEnhancement,
    sanitizeStudioBriaEnhancedPrompt,
    STUDIO_BRIA_PROMPT_ENHANCEMENT_ENDPOINT,
    STUDIO_BRIA_PROMPT_ENHANCEMENT_MODEL,
    type StudioBriaPromptEnhancement,
} from "@/lib/studioBriaPromptEnhancement";

export interface EnhanceStudioBriaPromptParams {
    imageUrl: string;
    userPrompt?: string;
    model?: string;
}

async function submitFalVisionPrompt(
    input: Record<string, unknown>,
    apiKey: string,
    maxPollSeconds = 60,
): Promise<Record<string, unknown>> {
    const submitRes = await fetch(`https://queue.fal.run/${STUDIO_BRIA_PROMPT_ENHANCEMENT_ENDPOINT}`, {
        method: "POST",
        headers: {
            "Authorization": `Key ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
    });
    if (!submitRes.ok) {
        const errBody = await submitRes.text();
        throw new Error(`fal.ai vision submit failed (${submitRes.status}): ${errBody.slice(0, 300)}`);
    }

    const submitData = await submitRes.json() as Record<string, unknown>;
    const requestId = submitData.request_id as string | undefined;
    if (!requestId) return submitData;

    const statusUrl = (submitData.status_url as string | undefined)
        || `https://queue.fal.run/${STUDIO_BRIA_PROMPT_ENHANCEMENT_ENDPOINT}/requests/${requestId}/status`;
    const responseUrl = (submitData.response_url as string | undefined)
        || `https://queue.fal.run/${STUDIO_BRIA_PROMPT_ENHANCEMENT_ENDPOINT}/requests/${requestId}`;

    const iterations = Math.ceil(maxPollSeconds / 2);
    for (let i = 0; i < iterations; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusRes = await fetch(statusUrl, {
            headers: { "Authorization": `Key ${apiKey}` },
        });
        if (!statusRes.ok) continue;
        const status = await statusRes.json() as { status?: string; error?: unknown };
        if (status.status === "COMPLETED") {
            const resultRes = await fetch(responseUrl, {
                headers: { "Authorization": `Key ${apiKey}` },
            });
            if (!resultRes.ok) {
                const errBody = await resultRes.text();
                throw new Error(`fal.ai vision result failed (${resultRes.status}): ${errBody.slice(0, 300)}`);
            }
            return await resultRes.json() as Record<string, unknown>;
        }
        if (status.status === "FAILED") {
            throw new Error(`fal.ai vision failed: ${String(status.error ?? "unknown")}`);
        }
    }

    throw new Error(`fal.ai vision timed out after ${maxPollSeconds} seconds`);
}

export async function enhanceStudioBriaPrompt(
    params: EnhanceStudioBriaPromptParams,
): Promise<StudioBriaPromptEnhancement> {
    const model = params.model || STUDIO_BRIA_PROMPT_ENHANCEMENT_MODEL;
    try {
        const apiKey = process.env.FAL_KEY;
        if (!apiKey) throw new Error("FAL_KEY is not configured");

        const input = {
            image_urls: [params.imageUrl],
            prompt: buildStudioBriaVisionInstruction(params.userPrompt),
            model,
        };
        const result = await submitFalVisionPrompt(input, apiKey);
        const prompt = sanitizeStudioBriaEnhancedPrompt(extractFalVisionOutput(result));
        if (!prompt) {
            throw new Error(`fal.ai vision returned no prompt. Keys: ${Object.keys(result).join(", ")}`);
        }

        return {
            prompt,
            provider: "fal-vision",
            model,
        };
    } catch (error) {
        console.error("[StudioBriaPromptEnhancer] Falling back:", error);
        return fallbackStudioBriaPromptEnhancement();
    }
}
