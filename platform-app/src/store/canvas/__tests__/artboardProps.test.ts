import { describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvasStore";
import {
    cascadeArtboardPropsForSwatchRemove,
    cloneArtboardProps,
    mergeArtboardPropsPatch,
    patchActiveFormatArtboardProps,
    resolveFormatArtboardProps,
    selectActiveArtboardProps,
} from "@/store/canvas/artboardProps";
import { DEFAULT_ARTBOARD_PROPS, DEFAULT_RESIZE } from "@/store/canvas/types";
import type { ResizeFormat } from "@/types";

describe("artboardProps helpers", () => {
    it("resolveFormatArtboardProps prefers format values over fallback", () => {
        const resolved = resolveFormatArtboardProps(
            { artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 24, fill: "#112233" } },
            { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0, fill: "#FFFFFF" },
        );
        expect(resolved.cornerRadius).toBe(24);
        expect(resolved.fill).toBe("#112233");
    });

    it("selectActiveArtboardProps returns stable reference for unchanged state", () => {
        const formatProps = { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 12 };
        const state = {
            resizes: [{ ...DEFAULT_RESIZE, id: "master", artboardProps: formatProps }],
            activeResizeId: "master",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
        };
        expect(selectActiveArtboardProps(state)).toBe(formatProps);
        expect(selectActiveArtboardProps(state)).toBe(selectActiveArtboardProps(state));
    });

    it("selectActiveArtboardProps falls back to top-level when format has no artboardProps", () => {
        const topLevel = { ...DEFAULT_ARTBOARD_PROPS, fill: "#ABCDEF" };
        const state = {
            resizes: [{ ...DEFAULT_RESIZE, id: "master" }],
            activeResizeId: "master",
            artboardProps: topLevel,
        };
        expect(selectActiveArtboardProps(state)).toBe(topLevel);
    });

    it("patchActiveFormatArtboardProps updates only the active format", () => {
        const feed: ResizeFormat = {
            ...DEFAULT_RESIZE,
            id: "feed",
            name: "Feed",
            label: "1080 × 1080",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 8 },
        };
        const story: ResizeFormat = {
            ...DEFAULT_RESIZE,
            id: "story",
            name: "Story",
            label: "1080 × 1920",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 16 },
        };
        const fallback = { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 };

        const { resizes } = patchActiveFormatArtboardProps(
            [feed, story],
            "feed",
            { cornerRadius: 32 },
            fallback,
        );

        expect(resizes.find((r) => r.id === "feed")?.artboardProps?.cornerRadius).toBe(32);
        expect(resizes.find((r) => r.id === "story")?.artboardProps?.cornerRadius).toBe(16);
    });

    it("patchActiveFormatArtboardProps is no-op when activeResizeId is missing", () => {
        const format: ResizeFormat = {
            ...DEFAULT_RESIZE,
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 8 },
        };
        const fallback = { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 };
        const { resizes } = patchActiveFormatArtboardProps(
            [format],
            "missing",
            { cornerRadius: 99 },
            fallback,
        );
        expect(resizes[0].artboardProps?.cornerRadius).toBe(8);
    });

    it("mergeArtboardPropsPatch clears backgroundImage when explicitly set to undefined", () => {
        const current = {
            ...DEFAULT_ARTBOARD_PROPS,
            backgroundImage: { src: "https://example.com/bg.png", fit: "cover" as const, opacity: 1 },
        };
        const merged = mergeArtboardPropsPatch(current, { backgroundImage: undefined });
        expect(merged.backgroundImage).toBeUndefined();
    });

    it("cascadeArtboardPropsForSwatchRemove detaches only matching formats", () => {
        const resizes: ResizeFormat[] = [
            {
                ...DEFAULT_RESIZE,
                id: "a",
                artboardProps: {
                    ...DEFAULT_ARTBOARD_PROPS,
                    backgroundImage: {
                        src: "https://example.com/a.png",
                        fit: "cover",
                        swatchRef: "bg-1",
                    },
                },
            },
            {
                ...DEFAULT_RESIZE,
                id: "b",
                artboardProps: {
                    ...DEFAULT_ARTBOARD_PROPS,
                    backgroundImage: {
                        src: "https://example.com/b.png",
                        fit: "cover",
                        swatchRef: "bg-2",
                    },
                },
            },
        ];
        const fallback = DEFAULT_ARTBOARD_PROPS;
        const next = cascadeArtboardPropsForSwatchRemove(resizes, fallback, "bg-1", "detach");
        expect(next.find((r) => r.id === "a")?.artboardProps?.backgroundImage?.swatchRef).toBeUndefined();
        expect(next.find((r) => r.id === "a")?.artboardProps?.backgroundImage?.src).toBe("https://example.com/a.png");
        expect(next.find((r) => r.id === "b")?.artboardProps?.backgroundImage?.swatchRef).toBe("bg-2");
    });

    it("cascadeArtboardPropsForSwatchRemove replace preserves per-format background opacity", () => {
        const resizes: ResizeFormat[] = [
            {
                ...DEFAULT_RESIZE,
                id: "a",
                artboardProps: {
                    ...DEFAULT_ARTBOARD_PROPS,
                    backgroundImage: {
                        src: "https://example.com/old.png",
                        fit: "cover",
                        opacity: 0.4,
                        swatchRef: "bg-1",
                    },
                },
            },
        ];
        const next = cascadeArtboardPropsForSwatchRemove(
            resizes,
            DEFAULT_ARTBOARD_PROPS,
            "bg-1",
            "replace",
            {
                resolveBgImage: (existing) => ({
                    src: "https://example.com/new.png",
                    fit: "contain",
                    opacity: existing?.opacity ?? 1,
                    swatchRef: "bg-2",
                }),
            },
        );
        expect(next[0].artboardProps?.backgroundImage).toEqual({
            src: "https://example.com/new.png",
            fit: "contain",
            opacity: 0.4,
            swatchRef: "bg-2",
        });
    });

    it("cloneArtboardProps creates independent nested objects", () => {
        const source = {
            ...DEFAULT_ARTBOARD_PROPS,
            cornerRadii: { topLeft: 4, topRight: 8 },
            backgroundImage: { src: "https://example.com/bg.png", fit: "cover" as const, opacity: 0.5 },
        };
        const cloned = cloneArtboardProps(source);
        cloned.cornerRadii!.topLeft = 99;
        cloned.backgroundImage!.opacity = 0.1;
        expect(source.cornerRadii?.topLeft).toBe(4);
        expect(source.backgroundImage?.opacity).toBe(0.5);
    });
});

describe("updateArtboardProps store integration", () => {
    it("writes corner radius to the active format only", () => {
        useCanvasStore.setState({
            resizes: [
                {
                    ...DEFAULT_RESIZE,
                    id: "master",
                    artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
                },
                {
                    ...DEFAULT_RESIZE,
                    id: "banner",
                    name: "Banner",
                    label: "1200 × 630",
                    width: 1200,
                    height: 630,
                    artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
                },
            ],
            activeResizeId: "banner",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
            history: [],
            future: [],
        });

        useCanvasStore.getState().updateArtboardProps({ cornerRadius: 20 });

        const state = useCanvasStore.getState();
        expect(selectActiveArtboardProps(state).cornerRadius).toBe(20);
        expect(state.resizes.find((r) => r.id === "master")?.artboardProps?.cornerRadius).toBe(0);
        expect(state.resizes.find((r) => r.id === "banner")?.artboardProps?.cornerRadius).toBe(20);
    });

    it("undo restores per-format artboard props", () => {
        useCanvasStore.setState({
            layers: [],
            resizes: [
                {
                    ...DEFAULT_RESIZE,
                    id: "master",
                    artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
                },
            ],
            activeResizeId: "master",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 0 },
            history: [],
            future: [],
        });

        useCanvasStore.getState().updateArtboardProps({ cornerRadius: 24 });
        expect(selectActiveArtboardProps(useCanvasStore.getState()).cornerRadius).toBe(24);

        useCanvasStore.getState().undo();
        expect(selectActiveArtboardProps(useCanvasStore.getState()).cornerRadius).toBe(0);
    });

    it("duplicateResize copies artboard props from the source format", () => {
        useCanvasStore.setState({
            layers: [],
            resizes: [
                {
                    ...DEFAULT_RESIZE,
                    id: "master",
                    artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 4, fill: "#111111" },
                },
            ],
            activeResizeId: "master",
            artboardProps: { ...DEFAULT_ARTBOARD_PROPS, cornerRadius: 4, fill: "#111111" },
            history: [],
            future: [],
        });

        useCanvasStore.getState().duplicateResize("master");

        const duplicate = useCanvasStore.getState().resizes.find((r) => r.id.startsWith("dup-"));
        expect(duplicate?.artboardProps?.cornerRadius).toBe(4);
        expect(duplicate?.artboardProps?.fill).toBe("#111111");
    });
});
