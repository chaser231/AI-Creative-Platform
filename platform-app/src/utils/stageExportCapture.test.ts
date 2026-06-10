import { describe, expect, it, vi } from "vitest";
import type Konva from "konva";

import { hideEditorChromeForCapture } from "./stageExportCapture";

function mockNode(visible = true): Konva.Node {
    let isVisible = visible;
    return {
        visible: vi.fn((next?: boolean) => {
            if (next === undefined) return isVisible;
            isVisible = next;
            return undefined as never;
        }),
    } as unknown as Konva.Node;
}

function mockStage(nodes: Record<string, Konva.Node[]>): Konva.Stage {
    return {
        find: vi.fn((selector: string) => {
            if (selector === "Transformer") return nodes.transformers ?? [];
            if (selector.startsWith(".")) return nodes[selector.slice(1)] ?? [];
            return [];
        }),
        findOne: vi.fn((selector: string) => {
            if (selector.startsWith("#")) return nodes[selector.slice(1)]?.[0];
            return undefined;
        }),
        batchDraw: vi.fn(),
    } as unknown as Konva.Stage;
}

describe("hideEditorChromeForCapture", () => {
    it("hides transformers, slice overlays, and the multi-select proxy", () => {
        const transformer = mockNode(true);
        const sliceOverlay = mockNode(true);
        const proxy = mockNode(true);
        const stage = mockStage({
            transformers: [transformer],
            "slice-overlay": [sliceOverlay],
            __multi_transform_proxy__: [proxy],
        });

        const restore = hideEditorChromeForCapture(stage);

        expect(transformer.visible()).toBe(false);
        expect(sliceOverlay.visible()).toBe(false);
        expect(proxy.visible()).toBe(false);

        restore();

        expect(transformer.visible()).toBe(true);
        expect(sliceOverlay.visible()).toBe(true);
        expect(proxy.visible()).toBe(true);
    });
});
