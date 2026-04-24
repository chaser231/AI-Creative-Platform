import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/server/auth", () => ({
    auth: () => mockAuth(),
}));

vi.mock("@/server/db", () => ({
    prisma: { __mock: true },
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockExecuteAction = vi.fn();
vi.mock("@/server/agent/executeAction", () => ({
    executeAction: (...args: unknown[]) => mockExecuteAction(...args),
}));

const mockAssertWorkspaceAccess = vi.fn();
vi.mock("@/server/authz/guards", () => ({
    assertWorkspaceAccess: (...args: unknown[]) => mockAssertWorkspaceAccess(...args),
}));

import { POST } from "../route";

// ─── Helpers ──────────────────────────────────────────────────────────
function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/workflow/execute-node", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const VALID_BODY = {
    actionId: "remove_background" as const,
    inputs: { "image-in": { imageUrl: "https://cdn.example.com/p.png" } },
    params: {},
    workspaceId: "ws_1",
};

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user_1" } });
    mockCheckRateLimit.mockReturnValue({ allowed: true, resetAt: Date.now() + 60000 });
    mockAssertWorkspaceAccess.mockResolvedValue(undefined);
});

// ─── Tests (7 cases per PLAN.md AC) ───────────────────────────────────

describe("POST /api/workflow/execute-node", () => {
    it("1. happy path — remove_background returns 200 with imageUrl", async () => {
        mockExecuteAction.mockResolvedValue({
            success: true,
            content: "https://s3/result.png",
            metadata: {
                imageUrl: "https://s3/result.png",
                provider: "replicate:bria-product-cutout",
                costUsd: 0.025,
            },
        });

        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.type).toBe("image");
        expect(json.imageUrl).toBe("https://s3/result.png");
        expect(json.metadata.provider).toBe("replicate:bria-product-cutout");
        expect(mockExecuteAction).toHaveBeenCalledWith(
            "remove_background",
            expect.objectContaining({ imageUrl: "https://cdn.example.com/p.png" }),
            expect.objectContaining({ userId: "user_1", workspaceId: "ws_1" }),
        );
    });

    it("2. unauthorized — no session returns 401 UNAUTHORIZED", async () => {
        mockAuth.mockResolvedValue(null);
        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();
        expect(res.status).toBe(401);
        expect(json.code).toBe("UNAUTHORIZED");
        expect(mockExecuteAction).not.toHaveBeenCalled();
    });

    it("3. rate-limited — returns 429 RATE_LIMITED with retryAfter", async () => {
        mockCheckRateLimit.mockReturnValue({
            allowed: false,
            resetAt: Date.now() + 5000,
        });
        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();
        expect(res.status).toBe(429);
        expect(json.code).toBe("RATE_LIMITED");
        expect(json.retryAfter).toBeGreaterThan(0);
        expect(mockExecuteAction).not.toHaveBeenCalled();
    });

    it("4. bad actionId — unknown actionId returns 400 BAD_REQUEST", async () => {
        const res = await POST(
            makeRequest({ ...VALID_BODY, actionId: "hack_world" }) as never,
        );
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.code).toBe("BAD_REQUEST");
        expect(mockExecuteAction).not.toHaveBeenCalled();
    });

    it("5. forbidden workspace — assertWorkspaceAccess throws → 403 UNAUTHORIZED", async () => {
        mockAssertWorkspaceAccess.mockRejectedValue(new Error("FORBIDDEN"));
        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();
        expect(res.status).toBe(403);
        expect(json.code).toBe("UNAUTHORIZED");
        expect(mockExecuteAction).not.toHaveBeenCalled();
    });

    it("6. SSRF blocked — executeAction SSRF failure returns 400 SSRF_BLOCKED", async () => {
        mockExecuteAction.mockResolvedValue({
            success: false,
            content: "URL заблокирован политикой SSRF (IP_BLOCKED)",
        });
        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();
        expect(res.status).toBe(400);
        expect(json.code).toBe("SSRF_BLOCKED");
    });

    it("7. provider failure — executeAction fails returns 502 PROVIDER_FAILED", async () => {
        mockExecuteAction.mockResolvedValue({
            success: false,
            content: "All replicate providers failed",
        });
        const res = await POST(makeRequest(VALID_BODY) as never);
        const json = await res.json();
        expect(res.status).toBe(502);
        expect(json.code).toBe("PROVIDER_FAILED");
    });

    it("allows generate_image and maps workflow prompt to action subject", async () => {
        mockExecuteAction.mockResolvedValue({
            success: true,
            type: "image",
            content: "https://s3/generated.png",
            metadata: { model: "flux-schnell" },
        });

        const res = await POST(
            makeRequest({
                actionId: "generate_image",
                inputs: {},
                params: {
                    prompt: "Studio product photo",
                    style: "photo",
                    model: "flux-schnell",
                    aspectRatio: "1:1",
                },
                workspaceId: "ws_1",
            }) as never,
        );
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.imageUrl).toBe("https://s3/generated.png");
        expect(mockExecuteAction).toHaveBeenCalledWith(
            "generate_image",
            expect.objectContaining({
                prompt: "Studio product photo",
                subject: "Studio product photo",
                style: "photo",
                model: "flux-schnell",
                aspectRatio: "1:1",
                imageUrl: undefined,
            }),
            expect.objectContaining({ workspaceId: "ws_1" }),
        );
    });
});
