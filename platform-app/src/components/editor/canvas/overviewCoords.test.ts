import { describe, expect, it } from "vitest";
import {
    artboardToScreen,
    artboardToWorld,
    artboardLengthToScreen,
    screenLengthToArtboard,
    screenToArtboard,
    screenToWorld,
    worldToArtboard,
    worldToScreen,
    type OverviewViewport,
    type TileOffset,
} from "./overviewCoords";

const VP: OverviewViewport = { zoom: 0.5, x: 100, y: 40 };
const TILE: TileOffset = { x: 1200, y: 800 };

describe("overviewCoords — world ↔ screen", () => {
    it("maps screen → world with zoom + translation", () => {
        // world = (screen - pos) / zoom
        expect(screenToWorld({ x: 100, y: 40 }, VP)).toEqual({ x: 0, y: 0 });
        expect(screenToWorld({ x: 200, y: 140 }, VP)).toEqual({ x: 200, y: 200 });
    });

    it("worldToScreen is the inverse of screenToWorld", () => {
        const screen = { x: 321, y: 654 };
        const round = worldToScreen(screenToWorld(screen, VP), VP);
        expect(round.x).toBeCloseTo(screen.x, 9);
        expect(round.y).toBeCloseTo(screen.y, 9);
    });
});

describe("overviewCoords — world ↔ artboard (tile offset)", () => {
    it("subtracts/adds the tile offset", () => {
        expect(worldToArtboard({ x: 1500, y: 900 }, TILE)).toEqual({ x: 300, y: 100 });
        expect(artboardToWorld({ x: 300, y: 100 }, TILE)).toEqual({ x: 1500, y: 900 });
    });

    it("degenerate tile {0,0} is identity", () => {
        expect(worldToArtboard({ x: 42, y: 7 }, { x: 0, y: 0 })).toEqual({ x: 42, y: 7 });
    });
});

describe("overviewCoords — screen ↔ artboard round-trip", () => {
    it("artboardToScreen ∘ screenToArtboard === identity", () => {
        const point = { x: 512.5, y: 199.25 };
        const local = screenToArtboard(point, VP, TILE);
        const back = artboardToScreen(local, VP, TILE);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
    });

    it("a layer-local point lands at the expected screen pixel", () => {
        // tile world (1200,800), local (40,60) → world (1240,860)
        // screen = world*0.5 + (100,40) = (720, 470)
        expect(artboardToScreen({ x: 40, y: 60 }, VP, TILE)).toEqual({ x: 720, y: 470 });
    });

    it("matches the single-artboard degenerate case", () => {
        const studioVp: OverviewViewport = { zoom: 2, x: 0, y: 0 };
        const studioTile: TileOffset = { x: 0, y: 0 };
        // screen = local * 2
        expect(artboardToScreen({ x: 10, y: 15 }, studioVp, studioTile)).toEqual({ x: 20, y: 30 });
        expect(screenToArtboard({ x: 20, y: 30 }, studioVp, studioTile)).toEqual({ x: 10, y: 15 });
    });
});

describe("overviewCoords — length scaling", () => {
    it("scales artboard ↔ screen lengths by zoom", () => {
        expect(artboardLengthToScreen(100, VP)).toBe(50);
        expect(screenLengthToArtboard(50, VP)).toBe(100);
    });
});
