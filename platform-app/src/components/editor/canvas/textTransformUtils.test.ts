import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import {
    FLIP_LAYER_CONTENT_NAME,
    getTextTransformBaseSize,
    normalizeLiveTextTransform,
    TEXT_LAYER_BOUNDS_NAME,
    TEXT_LAYER_CONTENT_NAME,
} from "./textTransformUtils";
import type { TextLayer } from "@/types";

function textLayer(overrides: Partial<TextLayer> = {}): TextLayer {
    return {
        id: "text-1",
        type: "text",
        name: "Text",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        visible: true,
        locked: false,
        opacity: 1,
        text: "Hello world",
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: "400",
        fill: "#111827",
        fillEnabled: true,
        align: "left",
        verticalAlign: "top",
        textAdjust: "auto_width",
        truncateText: false,
        ...overrides,
    } as TextLayer;
}

describe("textTransformUtils", () => {
    beforeAll(() => {
        const fakeContext = {
            font: "",
            fillStyle: "",
            clearRect: () => undefined,
            fillRect: () => undefined,
            getImageData: () => ({ data: new Uint8ClampedArray(Array.from({ length: 100 }, () => [40, 40, 40, 255]).flat()) }),
            save: () => undefined,
            restore: () => undefined,
            measureText: (value: string) => ({ width: value.length * 8 }),
        };

        vi.stubGlobal("document", {
            createElement: (tagName: string) => tagName === "canvas"
                ? { style: {}, getContext: () => fakeContext }
                : {},
        });
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    it("normalizes live transforms across text group, bounds, content, and flip wrapper", () => {
        const group = new Konva.Group({
            id: "text-1",
            width: 100,
            height: 40,
            scaleX: 1.5,
            scaleY: 2,
        });
        const bounds = new Konva.Rect({
            name: TEXT_LAYER_BOUNDS_NAME,
            width: 100,
            height: 40,
        });
        const flip = new Konva.Group({
            name: FLIP_LAYER_CONTENT_NAME,
            x: 100,
            scaleX: -1,
        });
        const text = new Konva.Text({
            name: TEXT_LAYER_CONTENT_NAME,
            text: "Hello world",
            width: 100,
            height: 40,
            wrap: "none",
        });

        flip.add(text);
        group.add(bounds, flip);

        normalizeLiveTextTransform(group, textLayer({ flipX: true }));

        expect(group.scaleX()).toBe(1);
        expect(group.scaleY()).toBe(1);
        expect(group.width()).toBe(150);
        expect(group.height()).toBe(80);
        expect(bounds.width()).toBe(150);
        expect(bounds.height()).toBe(80);
        expect(text.width()).toBe(150);
        expect(text.height()).toBe(80);
        expect(text.wrap()).toBe("word");
        expect(flip.x()).toBe(150);
    });

    it("prefers bounds rect over inflated group size for auto_width text", () => {
        const group = new Konva.Group({
            id: "text-1",
            width: 15740,
            height: 999,
            scaleX: 1.01,
            scaleY: 1,
        });
        const bounds = new Konva.Rect({
            name: TEXT_LAYER_BOUNDS_NAME,
            width: 824,
            height: 179,
        });
        const text = new Konva.Text({
            name: TEXT_LAYER_CONTENT_NAME,
            text: "МАРКЕТА",
            fontSize: 120,
            wrap: "none",
        });
        group.add(bounds, text);

        const layer = textLayer({ width: 824, height: 179, textAdjust: "auto_width" });
        expect(getTextTransformBaseSize(group, layer)).toEqual({ width: 824, height: 179 });

        normalizeLiveTextTransform(group, layer);
        expect(bounds.width()).toBeCloseTo(824 * 1.01, 0);
        expect(group.width()).toBeCloseTo(824 * 1.01, 0);
        expect(group.height()).toBe(179);
    });
});
