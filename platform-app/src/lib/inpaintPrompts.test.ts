import { describe, expect, it } from "vitest";

import { buildInpaintPrompt } from "./inpaintPrompts";

describe("buildInpaintPrompt", () => {
    it("uses outpaint profile without generic GPT inpaint suffix", () => {
        const built = buildInpaintPrompt({
            model: "gpt-image-2",
            intent: "edit",
            userPrompt: "футбольный мяч",
            promptProfile: "outpaint",
        });

        expect(built.effectiveProfile).toBe("outpaint");
        expect(built.prompt).toContain("Extend the scene naturally into the masked white areas.");
        expect(built.prompt).toContain("User context/style hint: футбольный мяч");
        expect(built.prompt).not.toContain("Edit only within the masked area");
    });

    it("keeps the default GPT inpaint edit profile unchanged", () => {
        const built = buildInpaintPrompt({
            model: "gpt-image-2",
            intent: "edit",
            userPrompt: "replace grass",
        });

        expect(built.effectiveProfile).toBe("default");
        expect(built.prompt).toContain("replace grass");
        expect(built.prompt).toContain("Edit only within the masked area");
    });
});
