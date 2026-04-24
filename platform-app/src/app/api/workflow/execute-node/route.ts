import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { executeAction } from "@/server/agent/executeAction";
import { assertWorkspaceAccess } from "@/server/authz/guards";
import type { ExecuteNodeRequest, ServerActionId } from "@/server/workflow/types";

// REQ-08: AI-heavy routes need the full Yandex Cloud Serverless 300s budget.
export const maxDuration = 300;

const ALLOWED_ACTIONS: ReadonlySet<string> = new Set<ServerActionId>([
    "generate_text",
    "generate_image",
    "remove_background",
    "add_reflection",
    "apply_mask",
    "apply_blur",
]);

type WorkflowInputValue = ExecuteNodeRequest["inputs"][string] | undefined;

function compactStrings(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const trimmed = value?.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

function collectTexts(input: WorkflowInputValue): string[] {
    return compactStrings([...(input?.texts ?? []), input?.text]);
}

function collectImageUrls(input: WorkflowInputValue): string[] {
    return compactStrings([...(input?.imageUrls ?? []), input?.imageUrl]);
}

function collectTextsFromInputs(inputs: ExecuteNodeRequest["inputs"], handles: string[]): string[] {
    return compactStrings(handles.flatMap((handle) => collectTexts(inputs[handle])));
}

function collectImageUrlsFromInputs(
    inputs: ExecuteNodeRequest["inputs"],
    handles: string[],
): string[] {
    return compactStrings(handles.flatMap((handle) => collectImageUrls(inputs[handle])));
}

function mergePrompt(localPrompt: unknown, upstreamTexts: string[]): string {
    const local = typeof localPrompt === "string" ? localPrompt.trim() : "";
    const parts: string[] = [];
    if (local) parts.push(local);
    if (upstreamTexts.length > 0) {
        parts.push(
            [
                "Контекст из подключенных текстовых нод:",
                ...upstreamTexts.map((text, index) => `${index + 1}. ${text}`),
            ].join("\n"),
        );
    }
    return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
    const requestId = randomUUID();

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: "Unauthorized",
                    code: "UNAUTHORIZED",
                    requestId,
                },
                { status: 401 },
            );
        }
        const userId = session.user.id;

        // Phase 1: stub rate-limit (30/min). Full 20/hr/user UI lands in Phase 4 (REQ-07).
        const rl = checkRateLimit(`workflow-node:${userId}`, { limit: 30, windowSeconds: 60 });
        if (!rl.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: "Слишком много запросов. Подождите минуту.",
                    code: "RATE_LIMITED",
                    requestId,
                    retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
                },
                { status: 429 },
            );
        }

        const body = (await req.json()) as Partial<ExecuteNodeRequest>;
        const { actionId, params, inputs, workspaceId } = body;

        if (!actionId || !ALLOWED_ACTIONS.has(actionId)) {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: `Unsupported actionId: ${actionId ?? "(missing)"}`,
                    code: "BAD_REQUEST",
                    requestId,
                },
                { status: 400 },
            );
        }
        if (!workspaceId || typeof workspaceId !== "string") {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: "workspaceId required",
                    code: "BAD_REQUEST",
                    requestId,
                },
                { status: 400 },
            );
        }
        if (!inputs || typeof inputs !== "object") {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: "inputs object required",
                    code: "BAD_REQUEST",
                    requestId,
                },
                { status: 400 },
            );
        }

        try {
            await assertWorkspaceAccess({ prisma, user: { id: userId } }, workspaceId);
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: "Forbidden workspace",
                    code: "UNAUTHORIZED",
                    requestId,
                },
                { status: 403 },
            );
        }

        const imageInput = inputs["image-in"];
        const actionParams = {
            ...(params ?? {}),
            imageUrl: imageInput?.imageUrl,
        };

        if (actionId === "generate_image") {
            const prompt = mergePrompt(
                params?.prompt,
                collectTextsFromInputs(inputs, ["context-in", "prompt-in"]),
            );
            const referenceImages = collectImageUrlsFromInputs(inputs, [
                "context-in",
                "reference-images",
            ]);
            Object.assign(actionParams, {
                prompt,
                subject: prompt,
                referenceImages,
            });
        }

        if (actionId === "generate_text") {
            const prompt = mergePrompt(
                params?.prompt,
                collectTextsFromInputs(inputs, ["context-in", "prompt-in"]),
            );
            const sourceImageUrls = collectImageUrlsFromInputs(inputs, [
                "context-in",
                "source-images",
            ]);
            Object.assign(actionParams, {
                prompt,
                sourceImageUrls,
            });
        }

        const result = await executeAction(
            actionId as ServerActionId,
            actionParams,
            { userId, workspaceId, prisma },
        );

        if (!result.success) {
            const lower = result.content.toLowerCase();
            const isSsrf = lower.includes("url заблокирован") || lower.includes("ssrf");
            const status = isSsrf ? 400 : 502;
            return NextResponse.json(
                {
                    success: false,
                    type: "error",
                    error: result.content,
                    code: isSsrf ? "SSRF_BLOCKED" : "PROVIDER_FAILED",
                    requestId,
                },
                { status },
            );
        }

        const metadata = (result.metadata ?? {}) as {
            imageUrl?: string;
            provider?: string;
            costUsd?: number;
            role?: string;
        };
        if (result.type === "text") {
            return NextResponse.json({
                success: true,
                type: "text",
                text: result.content,
                metadata: {
                    role: metadata.role,
                    provider: metadata.provider,
                    costUsd: metadata.costUsd,
                },
                requestId,
            });
        }

        const imageUrl = metadata.imageUrl ?? result.content;

        return NextResponse.json({
            success: true,
            type: "image",
            imageUrl,
            metadata: {
                provider: metadata.provider,
                costUsd: metadata.costUsd,
            },
            requestId,
        });
    } catch (err) {
        console.error(`[/api/workflow/execute-node][${requestId}]`, err);
        return NextResponse.json(
            {
                success: false,
                type: "error",
                error: err instanceof Error ? err.message : "Internal error",
                code: "PROVIDER_FAILED",
                requestId,
            },
            { status: 500 },
        );
    }
}
