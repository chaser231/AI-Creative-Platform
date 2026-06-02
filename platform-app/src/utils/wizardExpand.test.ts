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

    it("propagates an asymmetric outpaint focus (burger-near-top) onto resize instances", () => {
        // The wizard derives focusY from the source placement inside the
        // pack bitmap. For a screenshot pack (master 1192x300 +
        // vertical 470x762 + top-banner 853x92) the bottom extension is
        // far larger than the top extension, so focusY ≈ 0.28 — i.e. the
        // product centre lives in the upper third of the bitmap. The
        // resize-side cascade must carry this focus to the vertical /
        // top-banner instances or cover would crop the product out of
        // view.
        const resizeLayers: Layer[] = [{
            id: "vertical-image",
            type: "image",
            name: "Product",
            x: 0,
            y: 0,
            width: 470,
            height: 300,
            rotation: 0,
            visible: true,
            locked: false,
            src: "image.png",
            slotId: "image-primary",
            objectFit: "fill",
        }];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 470, height: 762 },
            masterArtboard: { width: 1192, height: 300 },
            overrides: {
                "master-image": {
                    prev: { x: 0, y: 0, width: 1192, height: 300 },
                    next: { x: -82, y: -105, width: 1356, height: 899 },
                    slotId: "image-primary",
                    masterId: "master-image",
                },
            },
            imageViewOverrides: {
                "master-image": { objectFit: "cover", focusX: 0.5, focusY: 0.284 },
            },
        });

        expect(projected[0]).toMatchObject({
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.284,
        });
        // Geometry: vertical instance must extend symmetrically with the
        // master expansion; the focus then pins the burger in view.
        const projectedRect = projected[0] as Layer;
        expect(projectedRect.width).toBeGreaterThan(470);
        expect(projectedRect.height).toBeGreaterThan(300);
    });

    it("forces every instance image layer to the resize artboard when fillInstanceArtboard is set", () => {
        // Single-pass pack outpaint: one bitmap is rendered with
        // `cover` into every format. Bindings cascade is bypassed for
        // the outpaint geometry, so each instance image rect collapses
        // to (0, 0, artboardW, artboardH). Without this, vertical
        // formats overhang the artboard and the bitmap's vertical
        // extension is hidden behind the artboard mask.
        const resizeLayers: Layer[] = [
            {
                id: "vertical-image",
                type: "image",
                name: "Product",
                x: 0,
                y: 0,
                width: 470,
                height: 300,
                rotation: 0,
                visible: true,
                locked: false,
                src: "image.png",
                slotId: "image-primary",
                objectFit: "fill",
            },
            {
                id: "headline",
                type: "text",
                name: "Headline",
                x: 24,
                y: 320,
                width: 200,
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
            resizeArtboard: { width: 470, height: 762 },
            masterArtboard: { width: 1192, height: 300 },
            overrides: {
                "master-image": {
                    prev: { x: 0, y: 0, width: 1192, height: 300 },
                    next: { x: -82, y: -105, width: 1356, height: 899 },
                    slotId: "image-primary",
                    masterId: "master-image",
                    fillInstanceArtboard: true,
                },
            },
            imageViewOverrides: {
                "master-image": { objectFit: "cover", focusX: 0.5, focusY: 0.117 },
            },
        });

        expect(projected[0]).toMatchObject({
            x: 0,
            y: 0,
            width: 470,
            height: 762,
            objectFit: "cover",
            focusX: 0.5,
            focusY: 0.117,
        });
        // Other layers (text) must remain untouched.
        expect(projected[1]).toBe(resizeLayers[1]);
    });

    it("also collapses the master image layer to the artboard for pack-fill previews", () => {
        const resizeLayers: Layer[] = [{
            id: "master-image",
            type: "image",
            name: "Product",
            x: 0,
            y: 0,
            width: 1192,
            height: 300,
            rotation: 0,
            visible: true,
            locked: false,
            src: "image.png",
            slotId: "image-primary",
            objectFit: "fill",
        }];

        const projected = projectExpansionToResize({
            resizeLayers,
            resizeArtboard: { width: 1192, height: 300 },
            masterArtboard: { width: 1192, height: 300 },
            overrides: {
                "master-image": {
                    prev: { x: 0, y: 0, width: 1192, height: 300 },
                    next: { x: -82, y: -105, width: 1356, height: 899 },
                    slotId: "image-primary",
                    masterId: "master-image",
                    fillInstanceArtboard: true,
                },
            },
            imageViewOverrides: {
                "master-image": { objectFit: "cover", focusX: 0.84, focusY: 0.117 },
            },
        });

        expect(projected[0]).toMatchObject({
            x: 0,
            y: 0,
            width: 1192,
            height: 300,
            objectFit: "cover",
            focusX: 0.84,
            focusY: 0.117,
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
