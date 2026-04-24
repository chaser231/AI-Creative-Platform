import { describe, expect, it } from "vitest";
import {
    MAX_WORKFLOW_IMAGE_UPLOAD_BYTES,
    validateWorkflowImageFile,
} from "../ImageSourceInput";

describe("validateWorkflowImageFile", () => {
    it("accepts image files within the upload limit", () => {
        const file = new File(["image"], "input.png", { type: "image/png" });

        expect(validateWorkflowImageFile(file)).toBeNull();
    });

    it("rejects non-image files", () => {
        const file = new File(["text"], "notes.txt", { type: "text/plain" });

        expect(validateWorkflowImageFile(file)).toBe("Выберите файл изображения");
    });

    it("rejects files over 20 MB", () => {
        const file = new File(
            [new Uint8Array(MAX_WORKFLOW_IMAGE_UPLOAD_BYTES + 1)],
            "large.png",
            { type: "image/png" },
        );

        expect(validateWorkflowImageFile(file)).toBe("Файл больше 20 МБ");
    });
});
