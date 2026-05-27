import { describe, expect, it } from "vitest";

import { projectExpansionToResize } from "./wizardExpand";
import type { Layer } from "@/types";

describe("projectExpansionToResize", () => {
    it("projects relative_size expansion without shifting unrelated layers", () => {
        const resizeLayers: Layer[] = [
            {
                id: "resize-image",
                type: "image",
                name: "Product",
                x: 10,
                y: 20,
                width: 200,
                height: 100,
                rotation: 0,
                visible: true,
                locked: false,
                src: "image.png",
                slotId: "image-primary",
                masterId: "master-image",
            },
            {
                id: "headline",
                type: "text",
                name: "Headline",
                x: 15,
                y: 25,
                width: 120,
                height: 40,
                rotation: 0,
                visible: true,
                locked: false,
                text: "Sale",
                fontSize: 24,
                fontFamily: "Inter",
                fontWeight: "700",
                fill: "#111111",
                align: "left",
                letterSpacing: 0,
                lineHeight: 1.2,
            },
        ];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 400, height: 300 },
            masterArtboard: { width: 800, height: 600 },
            overrides: {
                "master-image": {
                    prev: { x: 100, y: 100, width: 400, height: 200 },
                    next: { x: 0, y: 50, width: 550, height: 300 },
                    slotId: "image-primary",
                    masterId: "master-image",
                },
            },
        });

        expect(projected[0]).toMatchObject({
            x: -40,
            y: -5,
            width: 275,
            height: 150,
        });
        expect(projected[1]).toBe(resizeLayers[1]);
    });

    it("leaves content-only image geometry untouched", () => {
        const resizeLayers: Layer[] = [{
            id: "resize-image",
            type: "image",
            name: "Product",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: "image.png",
            slotId: "image-primary",
            masterId: "master-image",
        }];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 400, height: 300 },
            masterArtboard: { width: 800, height: 600 },
            resizeBindings: [{
                masterLayerId: "master-image",
                targetLayerId: "resize-image",
                syncContent: true,
                syncStyle: false,
                syncSize: false,
                syncPosition: false,
                imageSyncMode: "content",
            }],
            overrides: {
                "master-image": {
                    prev: { x: 100, y: 100, width: 400, height: 200 },
                    next: { x: 0, y: 50, width: 550, height: 300 },
                    slotId: "image-primary",
                    masterId: "master-image",
                },
            },
        });

        expect(projected[0]).toBe(resizeLayers[0]);
    });

    it("propagates image view override by slot while projecting geometry", () => {
        const resizeLayers: Layer[] = [{
            id: "resize-image",
            type: "image",
            name: "Product",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: "image.png",
            slotId: "image-primary",
            objectFit: "fill",
        }];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 400, height: 300 },
            masterArtboard: { width: 800, height: 600 },
            overrides: {
                "master-image": {
                    prev: { x: 100, y: 100, width: 400, height: 200 },
                    next: { x: 0, y: 50, width: 550, height: 300 },
                    slotId: "image-primary",
                    masterId: "master-image",
                },
            },
            imageViewOverrides: {
                "master-image": { objectFit: "cover", focusX: 0.5, focusY: 0.5 },
            },
        });

        expect(projected[0]).toMatchObject({
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.5,
            x: -40,
            y: -5,
            width: 275,
            height: 150,
        });
    });

    it("applies image view override even when content-only binding skips geometry", () => {
        const resizeLayers: Layer[] = [{
            id: "resize-image",
            type: "image",
            name: "Product",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            rotation: 0,
            visible: true,
            locked: false,
            src: "image.png",
            slotId: "image-primary",
            masterId: "master-image",
            objectFit: "fill",
        }];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 400, height: 300 },
            masterArtboard: { width: 800, height: 600 },
            resizeBindings: [{
                masterLayerId: "master-image",
                targetLayerId: "resize-image",
                syncContent: true,
                syncStyle: false,
                syncSize: false,
                syncPosition: false,
                imageSyncMode: "content",
            }],
            overrides: {
                "master-image": {
                    prev: { x: 100, y: 100, width: 400, height: 200 },
                    next: { x: 0, y: 50, width: 550, height: 300 },
                    slotId: "image-primary",
                    masterId: "master-image",
                },
            },
            imageViewOverrides: {
                "master-image": { objectFit: "cover", focusX: 0.5, focusY: 0.5 },
            },
        });

        expect(projected[0]).toMatchObject({
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.5,
        });
    });
});
