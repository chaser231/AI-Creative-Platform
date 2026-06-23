import { describe, expect, it } from "vitest";
import type Konva from "konva";
import { getPointerArtboardPosition, worldPointToArtboard } from "./getPointerArtboardPosition";

interface FakeStageOptions {
    pointer: { x: number; y: number } | null;
    zoom: number;
    stageX: number;
    stageY: number;
}

function makeStage({ pointer, zoom, stageX, stageY }: FakeStageOptions): Konva.Stage {
    return {
        getPointerPosition: () => pointer,
        scaleX: () => zoom,
        x: () => stageX,
        y: () => stageY,
    } as unknown as Konva.Stage;
}

describe("getPointerArtboardPosition", () => {
    it("matches the legacy (pointer - stage) / zoom formula when tile is {0,0}", () => {
        // Legacy math: canvasX = (p.x - stage.x()) / stage.scaleX().
        const stage = makeStage({ pointer: { x: 220, y: 140 }, zoom: 2, stageX: 100, stageY: 40 });
        const expected = { x: (220 - 100) / 2, y: (140 - 40) / 2 };

        expect(getPointerArtboardPosition(stage)).toEqual(expected);
        expect(getPointerArtboardPosition(stage, { x: 0, y: 0 })).toEqual(expected);
    });

    it("subtracts a non-zero tile offset (artboard-local = world - tile)", () => {
        // world = (p - stage) / zoom = (1200 - 100) / 0.5 = 2200; (800 - 40) / 0.5 = 1520.
        // local = world - tile = 2200 - 1200 = 1000; 1520 - 800 = 720.
        const stage = makeStage({ pointer: { x: 1200, y: 800 }, zoom: 0.5, stageX: 100, stageY: 40 });
        expect(getPointerArtboardPosition(stage, { x: 1200, y: 800 })).toEqual({ x: 1000, y: 720 });
    });

    it("returns null when the stage has no pointer (parity with getPointerPosition())", () => {
        const stage = makeStage({ pointer: null, zoom: 1, stageX: 0, stageY: 0 });
        expect(getPointerArtboardPosition(stage)).toBeNull();
        expect(getPointerArtboardPosition(stage, { x: 50, y: 50 })).toBeNull();
    });
});

describe("worldPointToArtboard", () => {
    const stage = makeStage({ pointer: { x: 0, y: 0 }, zoom: 1, stageX: 0, stageY: 0 });

    it("is identity for tile {0,0}", () => {
        expect(worldPointToArtboard(stage, { x: 42, y: -17 })).toEqual({ x: 42, y: -17 });
        expect(worldPointToArtboard(stage, { x: 42, y: -17 }, { x: 0, y: 0 })).toEqual({ x: 42, y: -17 });
    });

    it("subtracts the tile offset from a world point", () => {
        expect(worldPointToArtboard(stage, { x: 1500, y: 900 }, { x: 1200, y: 800 })).toEqual({ x: 300, y: 100 });
    });
});
