/**
 * Minimal hand-rolled fixtures. We can't ship real Figma responses in the repo
 * (licence of the shared files is unclear), so these are synthetic JSON objects
 * shaped like the Figma REST API's actual responses. The structure follows
 * `@figma/rest-api-spec` exactly; only the fields our mapper reads are filled in.
 */

import type { Component, DocumentNode } from "@figma/rest-api-spec";

export interface SyntheticFile {
    name: string;
    document: DocumentNode;
    components: Record<string, Component>;
}

function mkComponent(name: string): Component {
    return {
        key: `${name.toLowerCase().replace(/\W/g, "-")}-key`,
        name,
        description: "",
        documentationLinks: [],
        remote: false,
    } as unknown as Component;
}

// ─── A 1080×1080 Instagram-style frame with a background + headline + button ─
export const simpleBannerFixture: SyntheticFile = {
    name: "Simple Banner",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "2:0",
                        name: "Banner",
                        type: "FRAME",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 1080, height: 1080 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 1080, height: 1080 },
                        clipsContent: true,
                        blendMode: "PASS_THROUGH",
                        fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 1, a: 1 } }],
                        children: [
                            {
                                id: "2:1",
                                name: "Headline",
                                type: "TEXT",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 100, y: 200, width: 800, height: 120 },
                                absoluteRenderBounds: { x: 100, y: 200, width: 800, height: 120 },
                                blendMode: "NORMAL",
                                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                                characters: "Big Headline",
                                characterStyleOverrides: [],
                                styleOverrideTable: {},
                                style: {
                                    fontFamily: "Inter",
                                    fontWeight: 700,
                                    fontSize: 96,
                                    textAlignHorizontal: "CENTER",
                                    textAlignVertical: "TOP",
                                    letterSpacing: 0,
                                    lineHeightPx: 115.2,
                                    lineHeightUnit: "PIXELS",
                                    textCase: "UPPER",
                                },
                            } as unknown as DocumentNode["children"][number]["children"][number],
                            {
                                id: "2:2",
                                name: "Button",
                                type: "RECTANGLE",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 440, y: 800, width: 200, height: 60 },
                                absoluteRenderBounds: { x: 440, y: 800, width: 200, height: 60 },
                                blendMode: "NORMAL",
                                fills: [{ type: "SOLID", color: { r: 1, g: 0.8, b: 0, a: 1 } }],
                                strokes: [],
                                strokeWeight: 0,
                                cornerRadius: 30,
                                constraints: { horizontal: "CENTER", vertical: "BOTTOM" },
                            } as unknown as DocumentNode["children"][number]["children"][number],
                        ],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {},
};

// ─── An auto-layout frame mirroring Figma's HORIZONTAL + SPACE_BETWEEN ──────
export const autoLayoutFixture: SyntheticFile = {
    name: "Auto-layout row",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "2:0",
                        name: "Row",
                        type: "FRAME",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 80 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 400, height: 80 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [],
                        layoutMode: "HORIZONTAL",
                        paddingLeft: 16,
                        paddingRight: 16,
                        paddingTop: 8,
                        paddingBottom: 8,
                        itemSpacing: 12,
                        primaryAxisAlignItems: "SPACE_BETWEEN",
                        counterAxisAlignItems: "CENTER",
                        primaryAxisSizingMode: "FIXED",
                        counterAxisSizingMode: "AUTO",
                        children: [
                            {
                                id: "2:1",
                                name: "left",
                                type: "RECTANGLE",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 16, y: 8, width: 64, height: 64 },
                                absoluteRenderBounds: { x: 16, y: 8, width: 64, height: 64 },
                                blendMode: "NORMAL",
                                fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
                                strokes: [],
                                strokeWeight: 0,
                            } as unknown as DocumentNode["children"][number]["children"][number],
                            {
                                id: "2:2",
                                name: "right",
                                type: "RECTANGLE",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 320, y: 8, width: 64, height: 64 },
                                absoluteRenderBounds: { x: 320, y: 8, width: 64, height: 64 },
                                blendMode: "NORMAL",
                                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
                                strokes: [],
                                strokeWeight: 0,
                            } as unknown as DocumentNode["children"][number]["children"][number],
                        ],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {},
};

// ─── Frame containing a rectangle with an IMAGE fill ───────────────────────
export const imageFillFixture: SyntheticFile = {
    name: "With image",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "2:0",
                        name: "Hero",
                        type: "FRAME",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 400, height: 300 },
                        clipsContent: true,
                        blendMode: "PASS_THROUGH",
                        fills: [],
                        children: [
                            {
                                id: "2:1",
                                name: "Cover",
                                type: "RECTANGLE",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
                                absoluteRenderBounds: { x: 0, y: 0, width: 400, height: 300 },
                                blendMode: "NORMAL",
                                fills: [
                                    {
                                        type: "IMAGE",
                                        imageRef: "img-ref-abc123",
                                        scaleMode: "FILL",
                                    },
                                ],
                            } as unknown as DocumentNode["children"][number]["children"][number],
                        ],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {},
};

// ─── Component + Instance to test master-instance linking ─────────────────
export const componentInstanceFixture: SyntheticFile = {
    name: "Master + instance",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "10:0",
                        name: "Master/Button",
                        type: "COMPONENT",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 48 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 160, height: 48 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                        children: [],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                    {
                        id: "11:0",
                        name: "Instance/Button",
                        type: "INSTANCE",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        componentId: "10:0",
                        overrides: [],
                        absoluteBoundingBox: { x: 300, y: 300, width: 160, height: 48 },
                        absoluteRenderBounds: { x: 300, y: 300, width: 160, height: 48 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                        children: [],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {
        "10:0": mkComponent("Master/Button"),
    },
};

// ─── Instance appears BEFORE its master (tests two-pass scan, C2) ─────────
export const instanceBeforeMasterFixture: SyntheticFile = {
    name: "Instance before master",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page — uses",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "11:0",
                        name: "Instance/Button",
                        type: "INSTANCE",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        componentId: "10:0",
                        overrides: [],
                        absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 48 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 160, height: 48 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                        children: [],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
            {
                id: "2:0",
                name: "Page — library",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "10:0",
                        name: "Master/Button",
                        type: "COMPONENT",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 160, height: 48 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 160, height: 48 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
                        children: [],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {
        "10:0": mkComponent("Master/Button"),
    },
};

// ─── A VECTOR node to exercise the raster fallback ────────────────────────
export const vectorFallbackFixture: SyntheticFile = {
    name: "With vector",
    document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        scrollBehavior: "SCROLLS",
        children: [
            {
                id: "1:0",
                name: "Page 1",
                type: "CANVAS",
                visible: true,
                scrollBehavior: "SCROLLS",
                backgroundColor: { r: 1, g: 1, b: 1, a: 1 },
                prototypeStartNodeID: null,
                flowStartingPoints: [],
                prototypeDevice: { type: "NONE", rotation: "NONE" },
                children: [
                    {
                        id: "2:0",
                        name: "Wrapper",
                        type: "FRAME",
                        visible: true,
                        scrollBehavior: "SCROLLS",
                        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
                        absoluteRenderBounds: { x: 0, y: 0, width: 200, height: 200 },
                        clipsContent: false,
                        blendMode: "PASS_THROUGH",
                        fills: [],
                        children: [
                            {
                                id: "2:1",
                                name: "Logo",
                                type: "VECTOR",
                                visible: true,
                                scrollBehavior: "SCROLLS",
                                absoluteBoundingBox: { x: 20, y: 20, width: 160, height: 160 },
                                absoluteRenderBounds: { x: 20, y: 20, width: 160, height: 160 },
                                blendMode: "NORMAL",
                                fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
                                strokes: [],
                                strokeWeight: 0,
                            } as unknown as DocumentNode["children"][number]["children"][number],
                        ],
                    } as unknown as DocumentNode["children"][number]["children"][number],
                ],
            } as unknown as DocumentNode["children"][number],
        ],
    },
    components: {},
};
