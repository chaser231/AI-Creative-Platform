import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";

function seedActiveEditModes() {
    useCanvasStore.setState({
        viewMode: "single",
        expandMode: true,
        expandTargetLayerId: "layer-expand",
        inpaintMode: true,
        inpaintTargetLayerId: "layer-inpaint",
        vectorEditLayerId: "layer-vector",
        activeGradientEditorTarget: "layer-gradient",
    });
}

describe("createViewportSlice — setViewMode", () => {
    beforeEach(() => {
        useCanvasStore.getState().resetCanvas();
    });

    it("retires the exclusive edit modes when entering overview", () => {
        seedActiveEditModes();

        useCanvasStore.getState().setViewMode("overview");

        const s = useCanvasStore.getState();
        expect(s.viewMode).toBe("overview");
        expect(s.expandMode).toBe(false);
        expect(s.expandTargetLayerId).toBeNull();
        expect(s.inpaintMode).toBe(false);
        expect(s.inpaintTargetLayerId).toBeNull();
        expect(s.vectorEditLayerId).toBeNull();
        expect(s.activeGradientEditorTarget).toBeNull();
    });

    it("does not touch edit modes when returning to single view", () => {
        seedActiveEditModes();
        useCanvasStore.setState({ viewMode: "overview" });

        useCanvasStore.getState().setViewMode("single");

        const s = useCanvasStore.getState();
        expect(s.viewMode).toBe("single");
        expect(s.expandMode).toBe(true);
        expect(s.vectorEditLayerId).toBe("layer-vector");
        expect(s.activeGradientEditorTarget).toBe("layer-gradient");
    });
});
