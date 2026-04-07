import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-providers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { getModelById } from "@/lib/ai-models";

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
            imageBase64, projectId,
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

        // ── Track AI cost ──────────────────────────────────────────
        try {
            const modelEntry = getModelById(model);
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
            }

            if (aiSessionId) {
                await prisma.aIMessage.create({
                    data: {
                        sessionId: aiSessionId,
                        role: "assistant",
                        content: typeof result.content === "string" ? result.content.slice(0, 200) : "image generated",
                        type: (type as string) || "image",
                        model: model || "nano-banana-2",
                        costUnits: costPerRun,
                    },
                });
            }
        } catch (costErr) {
            console.error("[/api/ai/generate] Cost tracking failed:", costErr);
            // Non-blocking — don't fail the generation if tracking fails
        }

        return NextResponse.json(result);

    } catch (error: unknown) {
        const err = error as Error;
        console.error("AI Generation API Error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
