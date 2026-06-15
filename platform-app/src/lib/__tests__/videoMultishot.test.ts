import { describe, expect, it } from "vitest";
import { getVideoModelById } from "../video-models";
import {
    compileSeedanceMultiShotPrompt,
    createDefaultShots,
    formatMultiShotLines,
    parseMultiShotConfig,
    parseMultiShotLines,
    resolveEffectiveDuration,
    sumShotDurationSec,
    validateMultiShot,
    buildMultiShotConfigFromWorkflowParams,
} from "../video-multishot";

describe("compileSeedanceMultiShotPrompt", () => {
    it("builds timestamp markers with cut scene transitions", () => {
        const out = compileSeedanceMultiShotPrompt([
            { prompt: "wide city skyline", durationSec: 5 },
            { prompt: "close-up of glass", durationSec: 5 },
        ]);
        expect(out).toBe(
            "[0-5s] wide city skyline Cut scene to [5-10s] close-up of glass",
        );
    });
});

describe("parseMultiShotLines / formatMultiShotLines", () => {
    it("round-trips workflow textarea format", () => {
        const shots = parseMultiShotLines("5|first shot\n3|second");
        expect(shots).toEqual([
            { durationSec: 5, prompt: "first shot" },
            { durationSec: 3, prompt: "second" },
        ]);
        expect(formatMultiShotLines(shots)).toBe("5|first shot\n3|second");
    });
});

describe("validateMultiShot", () => {
    const kling = getVideoModelById("kling-3.0-pro")!;

    it("rejects empty shot prompts in customize mode", () => {
        const err = validateMultiShot(
            kling,
            { enabled: true, shots: createDefaultShots(2, 5), shotType: "customize" },
            "t2v",
        );
        expect(err).toMatch(/Шот 1/);
    });

    it("passes valid kling multi-shot config", () => {
        const err = validateMultiShot(
            kling,
            {
                enabled: true,
                shotType: "customize",
                shots: [
                    { prompt: "wide", durationSec: 5 },
                    { prompt: "close", durationSec: 5 },
                ],
            },
            "t2v",
        );
        expect(err).toBeNull();
    });

    it("rejects total duration over cap", () => {
        const err = validateMultiShot(
            kling,
            {
                enabled: true,
                shotType: "customize",
                shots: [
                    { prompt: "a", durationSec: 8 },
                    { prompt: "b", durationSec: 8 },
                ],
            },
            "t2v",
        );
        expect(err).toMatch(/15/);
    });

    it("skips shot list validation for intelligent mode", () => {
        const err = validateMultiShot(
            kling,
            { enabled: true, shots: [], shotType: "intelligent" },
            "t2v",
        );
        expect(err).toBeNull();
    });
});

describe("parseMultiShotConfig", () => {
    it("parses enabled config from API body shape", () => {
        const cfg = parseMultiShotConfig({
            enabled: true,
            shotType: "customize",
            shots: [{ prompt: "x", durationSec: 5 }],
        });
        expect(cfg).toEqual({
            enabled: true,
            shotType: "customize",
            shots: [{ prompt: "x", durationSec: 5 }],
        });
    });

    it("returns null when disabled", () => {
        expect(parseMultiShotConfig({ enabled: false })).toBeNull();
    });
});

describe("resolveEffectiveDuration", () => {
    it("sums shot durations in customize multi-shot mode", () => {
        const model = getVideoModelById("seedance-2.0")!;
        const d = resolveEffectiveDuration(
            model,
            {
                enabled: true,
                shotType: "customize",
                shots: [
                    { prompt: "a", durationSec: 4 },
                    { prompt: "b", durationSec: 6 },
                ],
            },
            "5",
        );
        expect(d).toBe("10");
    });
});

describe("buildMultiShotConfigFromWorkflowParams", () => {
    it("builds config from workflow node fields", () => {
        const cfg = buildMultiShotConfigFromWorkflowParams({
            multiShotEnabled: true,
            multiShotType: "customize",
            multiShotLines: "5|scene one\n5|scene two",
        });
        expect(cfg?.enabled).toBe(true);
        expect(cfg?.shots).toHaveLength(2);
    });
});
