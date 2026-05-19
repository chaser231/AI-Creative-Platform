import { describe, expect, it } from "vitest";
import { usePhotoStore } from "./photoStore";

describe("photoStore pending generations", () => {
    it("adds and clears pending generation placeholders", () => {
        usePhotoStore.setState({ pendingGenerations: [] });

        usePhotoStore.getState().addPendingGeneration({
            id: "pending-1",
            sessionId: "session-1",
            count: 3,
            aspectRatio: "16:9",
            prompt: "football ball",
        });

        expect(usePhotoStore.getState().pendingGenerations).toHaveLength(1);
        expect(usePhotoStore.getState().pendingGenerations[0]).toMatchObject({
            id: "pending-1",
            count: 3,
        });

        usePhotoStore.getState().clearPendingGeneration("pending-1");

        expect(usePhotoStore.getState().pendingGenerations).toEqual([]);
    });
});
