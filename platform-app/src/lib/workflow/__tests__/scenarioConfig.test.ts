import { describe, expect, it } from "vitest";
import {
    defaultWorkflowScenarioConfig,
    normalizeWorkflowScenarioConfig,
    workflowScenarioConfigSchema,
} from "@/lib/workflow/scenarioConfig";

describe("workflowScenarioConfig", () => {
    it("creates a disabled default scenario config with image input", () => {
        const config = defaultWorkflowScenarioConfig("Remove BG");
        expect(config.enabled).toBe(false);
        expect(config.title).toBe("Remove BG");
        expect(config.input.kind).toBe("image");
        expect(config.output.behavior).toBe("replace-selection");
        expect(config.surfaces).toEqual(["banner", "photo", "asset"]);
    });

    it("validates an enabled banner/photo scenario", () => {
        const parsed = workflowScenarioConfigSchema.safeParse({
            enabled: true,
            title: "Product cleanup",
            surfaces: ["banner", "photo"],
            input: { kind: "image", required: true },
            output: { kind: "image", behavior: "create-layer" },
        });

        expect(parsed.success).toBe(true);
    });

    it("normalizes invalid data back to a disabled config", () => {
        const config = normalizeWorkflowScenarioConfig(
            { enabled: true, title: "" },
            "Fallback",
        );

        expect(config.enabled).toBe(false);
        expect(config.title).toBe("Fallback");
    });
});
