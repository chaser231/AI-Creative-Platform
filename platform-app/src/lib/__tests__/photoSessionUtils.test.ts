import { describe, expect, it } from "vitest";
import {
    pickBetterEditorSessionForUser,
    pickDefaultPhotoSession,
    pickEditorSession,
    shouldAutoCreatePhotoSession,
    type EditorSessionCandidate,
    type PhotoSessionCandidate,
} from "../photoSessionUtils";

function session(
    id: string,
    messages: number,
    updatedAt: string,
    userId?: string,
): EditorSessionCandidate {
    return {
        id,
        _count: { messages },
        updatedAt,
        ...(userId ? { user: { id: userId } } : {}),
    };
}

function photoSession(
    id: string,
    messages: number,
    updatedAt: string,
): PhotoSessionCandidate {
    return { id, _count: { messages }, updatedAt };
}

describe("pickDefaultPhotoSession", () => {
    it("returns null for empty list", () => {
        expect(pickDefaultPhotoSession([])).toBeNull();
    });

    it("prefers session with most messages over most recent empty session", () => {
        const sessions = [
            photoSession("empty-new", 0, "2026-06-30T12:00:00Z"),
            photoSession("full-old", 16, "2026-06-29T10:00:00Z"),
        ];
        expect(pickDefaultPhotoSession(sessions)).toBe("full-old");
    });

    it("tie-breaks equal message counts by updatedAt", () => {
        const sessions = [
            photoSession("a", 5, "2026-06-28T10:00:00Z"),
            photoSession("b", 5, "2026-06-30T10:00:00Z"),
        ];
        expect(pickDefaultPhotoSession(sessions)).toBe("b");
    });
});

describe("pickEditorSession", () => {
    it("prefers current user's session over a colleague's fuller session", () => {
        const sessions = [
            session("colleague", 20, "2026-06-30T12:00:00Z", "user-a"),
            session("mine-empty", 0, "2026-06-30T11:00:00Z", "user-b"),
            session("mine-full", 8, "2026-06-29T10:00:00Z", "user-b"),
        ];
        expect(pickEditorSession(sessions, "user-b")).toBe("mine-full");
    });

    it("falls back to all project sessions when user has none", () => {
        const sessions = [
            session("colleague", 5, "2026-06-30T12:00:00Z", "user-a"),
        ];
        expect(pickEditorSession(sessions, "user-b")).toBe("colleague");
    });
});

describe("pickBetterEditorSessionForUser", () => {
    it("returns null when already on own session", () => {
        const sessions = [session("mine", 3, "2026-06-30T12:00:00Z", "user-b")];
        expect(pickBetterEditorSessionForUser(sessions, "user-b", "mine")).toBeNull();
    });

    it("switches from colleague session to user's best session", () => {
        const sessions = [
            session("colleague", 20, "2026-06-30T12:00:00Z", "user-a"),
            session("mine", 6, "2026-06-29T10:00:00Z", "user-b"),
        ];
        expect(pickBetterEditorSessionForUser(sessions, "user-b", "colleague")).toBe("mine");
    });
});

describe("shouldAutoCreatePhotoSession", () => {
    it("returns true only when no sessions exist", () => {
        expect(shouldAutoCreatePhotoSession([])).toBe(true);
        expect(shouldAutoCreatePhotoSession([photoSession("s1", 0, "2026-01-01")])).toBe(false);
    });
});
