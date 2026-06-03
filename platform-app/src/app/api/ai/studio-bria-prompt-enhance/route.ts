import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/server/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { enhanceStudioBriaPrompt } from "@/server/studioBriaPromptEnhancer";

export const maxDuration = 90;

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
        }

        const userId = session.user.id ?? "anon";
        const rl = checkRateLimit(`ai-edit-prompt-enhance:${userId}`, { limit: 30, windowSeconds: 60 });
        if (!rl.allowed) {
            return NextResponse.json(
                {
                    error: "Слишком много запросов. Подождите минуту.",
                    requestId,
                    retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
                },
                { status: 429 },
            );
        }

        const body = await req.json() as {
            imageUrl?: unknown;
            prompt?: unknown;
            model?: unknown;
        };
        if (typeof body.imageUrl !== "string" || !/^https?:\/\//i.test(body.imageUrl)) {
            return NextResponse.json({ error: "imageUrl must be an http(s) URL", requestId }, { status: 400 });
        }

        const enhancement = await enhanceStudioBriaPrompt({
            imageUrl: body.imageUrl,
            userPrompt: typeof body.prompt === "string" ? body.prompt : undefined,
            model: typeof body.model === "string" ? body.model : undefined,
        });

        return NextResponse.json({ enhancement, requestId });
    } catch (error: unknown) {
        const err = error as Error;
        console.error("[/api/ai/studio-bria-prompt-enhance] error", { requestId, error: err });
        return NextResponse.json({ error: err.message || "Internal Server Error", requestId }, { status: 500 });
    }
}
