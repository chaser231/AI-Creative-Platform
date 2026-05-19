import { describe, expect, it } from "vitest";
import { isRetryableGenerationError, parseGenerationError } from "@/lib/parseGenerationError";

describe("parseGenerationError", () => {
    it("maps rate limit errors", () => {
        expect(parseGenerationError(new Error("HTTP 429 rate limit"))).toContain(
            "Слишком много запросов",
        );
    });

    it("maps fal capacity errors", () => {
        expect(parseGenerationError(new Error("queue is full at capacity"))).toContain(
            "перегружен",
        );
    });

    it("maps E003 / high demand", () => {
        expect(parseGenerationError(new Error("E003 high demand"))).toContain(
            "Слишком много запросов",
        );
    });

    it("maps timeout errors", () => {
        expect(parseGenerationError(new Error("prediction timed out"))).toContain(
            "слишком много времени",
        );
    });
});

describe("isRetryableGenerationError", () => {
    it("detects retryable provider overload", () => {
        expect(isRetryableGenerationError(new Error("429 Too Many Requests"))).toBe(true);
        expect(isRetryableGenerationError(new Error("concurrent request limit"))).toBe(true);
        expect(isRetryableGenerationError(new Error("invalid prompt"))).toBe(false);
    });
});
