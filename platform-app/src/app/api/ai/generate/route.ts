import { NextRequest, NextResponse } from "next/server";
import { generateWithFallback } from "@/lib/ai-providers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { getModelById } from "@/lib/ai-models";
import { checkRateLimit } from "@/lib/rateLimit";
import { randomUUID } from "crypto";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const requestId = randomUUID();
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized", requestId }, { status: 401 });
        }

        const userId = session.user.id ?? "anon";
        const rl = checkRateLimit(`ai-gen:${userId}`, { limit: 30, windowSeconds: 60 });
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Слишком много запросов. Подождите минуту.", requestId, retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
                { status: 429 },
            );
        }

        const body = await req.json();
        const {
            prompt, type, model,
            aspectRatio, count, seed, scale,
            referenceImages, systemPrompt,
            imageBase64, projectId,
            // When the client persists the result itself (e.g. photo workspace saves
            // the S3-backed URL into AIMessage on its own), it sets `recordMessage: false`
            // to avoid duplicating the assistant message.
            recordMessage = true,
        } = body;

        if (!prompt) {
            return NextResponse.json({ error: "Prompt is required", requestId }, { status: 400 });
        }

        // Debug: confirm referenceImages arrive at the route
        if (referenceImages && referenceImages.length > 0) {
            console.log(`[/api/ai/generate] referenceImages: ${referenceImages.length} image(s), first ~80 chars: ${String(referenceImages[0]).slice(0, 80)}`);
        }

        console.log("[/api/ai/generate] request", {
            requestId,
            userId: session.user.id,
            type: type || "image",
            model,
            projectId,
            aspectRatio,
            count,
            seed,
            scale,
            hasReferenceImages: Array.isArray(referenceImages) && referenceImages.length > 0,
        });

        const result = await generateWithFallback({
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


        // ── Track AI cost ──────────────────────────────────────────
        // Skipped when caller opts out via `recordMessage: false`
        // (e.g. /photo workspace writes the AIMessage itself with the persisted S3 URL).
        try {
            if (!recordMessage) {
                return NextResponse.json({ ...result, requestId });
            }
            const resolvedModel = model || "nano-banana-2";
            const modelEntry = getModelById(resolvedModel);
            const costPerRun = modelEntry?.costPerRun ?? 0;
            const userId = session.user.id;

            // Find or create an AI session for this project/user
            let aiSessionId: string | undefined;
            if (projectId) {
                const existing = await prisma.aISession.findFirst({
                    where: { projectId, userId },
                    orderBy: { updatedAt: "desc" },
                    select: { id: true },
                });
                aiSessionId = existing?.id;
                if (!aiSessionId) {
                    const newSession = await prisma.aISession.create({
                        data: { projectId, userId },
                    });
                    aiSessionId = newSession.id;
                }
            } else {
                // No projectId — try to find any recent session for this user
                const fallback = await prisma.aISession.findFirst({
                    where: { userId },
                    orderBy: { updatedAt: "desc" },
                    select: { id: true },
                });
                aiSessionId = fallback?.id;
            }

            if (aiSessionId) {
                await prisma.aIMessage.create({
                    data: {
                        sessionId: aiSessionId,
                        role: "assistant",
                        content: typeof result.content === "string" ? result.content.slice(0, 200) : "image generated",
                        type: (type as string) || "image",
                        model: resolvedModel,
                        costUnits: costPerRun,
                    },
                });
            } else {
                console.warn("[/api/ai/generate] No session found for cost tracking — generation not tracked");
            }
        } catch (costErr) {
            console.error("[/api/ai/generate] Cost tracking failed:", costErr);
            // Non-blocking — don't fail the generation if tracking fails
        }

        return NextResponse.json({ ...result, requestId });

    } catch (error: unknown) {
        const err = error as Error;
        console.error("AI Generation API Error:", { requestId, error: err });
        return NextResponse.json({ error: err.message || "Internal Server Error", requestId }, { status: 500 });
    }
}
