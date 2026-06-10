import { describe, expect, it } from "vitest";
import { getWorkflowNodePreview } from "../preview";

describe("getWorkflowNodePreview", () => {
    it("prefers imageInput sourceUrl over a stale run result", () => {
        expect(
            getWorkflowNodePreview(
                "imageInput",
                { sourceUrl: "https://example.com/input.png" },
                { url: "https://example.com/result.png" },
            ),
        ).toEqual({
            url: "https://example.com/input.png",
            source: "input",
        });
    });

    it("uses run results for transform nodes", () => {
        expect(
            getWorkflowNodePreview(
                "removeBackground",
                { sourceUrl: "https://example.com/input.png" },
                { url: "https://example.com/result.png" },
            ),
        ).toEqual({
            url: "https://example.com/result.png",
            source: "result",
            isVideo: false,
        });
    });

    it("marks video result urls so BaseNode renders a <video>", () => {
        expect(
            getWorkflowNodePreview(
                "textToVideo",
                { prompt: "ocean waves" },
                { url: "https://example.com/result.mp4" },
            ),
        ).toEqual({
            url: "https://example.com/result.mp4",
            source: "result",
            isVideo: true,
        });
    });

    it("uses imageInput sourceUrl before a run", () => {
        expect(
            getWorkflowNodePreview(
                "imageInput",
                { sourceUrl: "https://example.com/input.png" },
                undefined,
            ),
        ).toEqual({
            url: "https://example.com/input.png",
            source: "input",
        });
    });

    it("does not infer previews for transform nodes without results", () => {
        expect(
            getWorkflowNodePreview(
                "removeBackground",
                { sourceUrl: "https://example.com/input.png" },
                undefined,
            ),
        ).toBeNull();
    });

    it("uses text results for text generation nodes", () => {
        expect(
            getWorkflowNodePreview(
                "textGeneration",
                { prompt: "Sale headline" },
                { text: "Скидки уже здесь" },
            ),
        ).toEqual({
            text: "Скидки уже здесь",
            source: "result",
        });
    });
});
