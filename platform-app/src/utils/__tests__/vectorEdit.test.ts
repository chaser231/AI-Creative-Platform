import { describe, expect, it } from "vitest";
import type { VectorLayer } from "@/types";
import {
    isReadOnlyImportedPath,
    parseEditableSubpaths,
    vectorLayerToEditableUpdates,
    visibleAnchorIndices,
} from "../vectorEdit";

describe("vectorLayerToEditableUpdates", () => {
    it("converts inlineSvg import into normalized subpaths", () => {
        const layer: VectorLayer = {
            id: "v1",
            type: "vector",
            name: "Subtract",
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            rotation: 0,
            visible: true,
            locked: false,
            subpaths: [],
            fill: "#ffffff",
            rawSvgPath: "M 10 10 H 90 V 90 H 10 Z",
        };

        const parsed = parseEditableSubpaths(layer);
        expect(parsed?.length).toBeGreaterThan(0);
        expect(parsed?.[0]?.points.length).toBeGreaterThan(1);

        const updates = vectorLayerToEditableUpdates(layer);
        expect(updates?.subpaths?.length).toBeGreaterThan(0);
        expect(updates?.inlineSvg).toBeUndefined();
    });

    it("marks compound inlineSvg imports as read-only", () => {
        const layer: VectorLayer = {
            id: "v2",
            type: "vector",
            name: "Subtract",
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            rotation: 0,
            visible: true,
            locked: false,
            subpaths: [],
            fill: "#ffffff",
            fillRule: "evenodd",
            inlineSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 80 80"><path d="M10 20 H90 V100 H10 Z" fill="#fff"/><path d="M30 40 H70 V80 H30 Z" fill="#fff" fill-rule="evenodd"/></svg>',
        };
        expect(isReadOnlyImportedPath(layer)).toBe(true);
        expect(vectorLayerToEditableUpdates(layer)).toBeNull();
    });

    it("decimates visible anchors for dense paths", () => {
        const dense = Array.from({ length: 120 }, (_, i) => ({
            x: i / 120,
            y: 0.5,
            type: "corner" as const,
        }));
        const visible = visibleAnchorIndices([{ points: dense, closed: false }], 40);
        expect(visible.length).toBeLessThanOrEqual(40);
        expect(visible.length).toBeGreaterThan(0);
    });
});
