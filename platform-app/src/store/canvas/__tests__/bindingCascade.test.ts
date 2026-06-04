import { describe, expect, it } from "vitest";
import type { LayerBinding } from "@/types";
import { getPropsForBinding } from "../bindingCascade";

describe("binding cascade helpers", () => {
    it("syncs flip state with transform position bindings", () => {
        const binding: LayerBinding = {
            masterLayerId: "master-layer",
            targetLayerId: "target-layer",
            syncContent: false,
            syncStyle: false,
            syncSize: false,
            syncPosition: true,
        };

        expect(getPropsForBinding(binding)).toEqual(["x", "y", "rotation", "flipX", "flipY"]);
    });
});
