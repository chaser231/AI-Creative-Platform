import { describe, expect, it } from "vitest";
import {
    describeTemplatePackAdaptationMode,
    generateTemplateResizes,
    supportsSnapshotAdaptation,
} from "@/services/templateAdaptationService";
import type { TemplatePack } from "@/services/templateService";
import type { MasterComponent, RectangleLayer, ResizeFormat } from "@/types";

function rect(): RectangleLayer {
    return {
        id: "rect-1",
        type: "rectangle",
        name: "Hero",
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        rotation: 0,
        visible: true,
        locked: false,
        fill: "#FFFFFF",
        stroke: "",
        strokeWidth: 0,
        cornerRadius: 0,
    };
}

function master(overrides: Partial<MasterComponent> = {}): MasterComponent {
    return {
        id: "mc-1",
        type: "rectangle",
        name: "Hero",
        slotId: "hero",
        props: {
            type: "rectangle",
            x: 10,
            y: 10,
            width: 80,
            height: 80,
            rotation: 0,
            visible: true,
            locked: false,
            fill: "#FFFFFF",
            stroke: "",
            strokeWidth: 0,
            cornerRadius: 0,
        },
        ...overrides,
    };
}

function pack(overrides: Partial<TemplatePack> = {}): TemplatePack {
    return {
        id: "pack-1",
        version: "1.2.0",
        name: "Pack",
        description: "",
        baseWidth: 100,
        baseHeight: 100,
        masterComponents: [master()],
        resizes: [
            { id: "master", name: "Master", width: 100, height: 100, label: "100 × 100", instancesEnabled: false },
            { id: "wide", name: "Wide", width: 200, height: 100, label: "200 × 100", instancesEnabled: false },
        ],
        ...overrides,
    };
}

describe("templateAdaptationService", () => {
    it("classifies modern packs with layers as snapshot-pipeline", () => {
        const modern = pack({ layers: [rect()] });
        expect(supportsSnapshotAdaptation(modern)).toBe(true);
        expect(describeTemplatePackAdaptationMode(modern)).toBe("snapshot-pipeline");
    });

    it("classifies legacy packs without layers as legacy-instances", () => {
        const legacy = pack();
        expect(supportsSnapshotAdaptation(legacy)).toBe(false);
        expect(describeTemplatePackAdaptationMode(legacy)).toBe("legacy-instances");
    });

    it("snapshot path produces layerSnapshot resizes without instances", () => {
        const result = generateTemplateResizes(
            [master()],
            [rect()],
            { width: 100, height: 100 },
            pack({ layers: [rect()] }),
            [{ masterId: "mc-1", masterName: "Hero", masterType: "rectangle", templateMasterId: "mc-1", templateMasterName: "Hero", confidence: 1 }],
        );

        expect(result.instances).toEqual([]);
        expect(result.resizes).toHaveLength(1);
        expect(result.resizes[0]?.layerSnapshot?.length).toBeGreaterThan(0);
        expect(result.resizes[0]).toMatchObject({ id: "wide", width: 200, height: 100, instancesEnabled: false });
    });

    it("legacy path still creates component instances", () => {
        const templateMaster = master({ id: "tm-1" });
        const legacyPack = pack({
            masterComponents: [templateMaster],
            componentInstances: [{
                id: "inst-1",
                masterId: "tm-1",
                resizeId: "wide",
                localProps: templateMaster.props,
            }],
        });

        const result = generateTemplateResizes(
            [master({ id: "cm-1" })],
            [],
            { width: 100, height: 100 },
            legacyPack,
            [{
                masterId: "cm-1",
                masterName: "Hero",
                masterType: "rectangle",
                templateMasterId: "tm-1",
                templateMasterName: "Hero",
                confidence: 1,
            }],
        );

        expect(result.instances).toHaveLength(1);
        expect(result.resizes.map((r: ResizeFormat) => r.id)).toEqual(["wide"]);
    });
});
