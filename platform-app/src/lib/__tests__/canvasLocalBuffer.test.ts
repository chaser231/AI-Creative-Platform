import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const idbState = new Map<IDBValidKey, unknown>();

vi.mock("idb-keyval", () => ({
    createStore: vi.fn(() => ({})),
    get: vi.fn(async (key: IDBValidKey) => idbState.get(key)),
    set: vi.fn(async (key: IDBValidKey, value: unknown) => {
        idbState.set(key, value);
    }),
    del: vi.fn(async (key: IDBValidKey) => {
        idbState.delete(key);
    }),
    keys: vi.fn(async () => Array.from(idbState.keys())),
}));

import {
    saveLocalDraft,
    loadLocalDraft,
    clearLocalDraft,
    stashRejectedDraft,
    __resetCanvasLocalBufferForTests,
    type CanvasLocalDraft,
} from "../canvasLocalBuffer";

const PROJECT_ID = "cuid_test_project_123";

function makeDraft(overrides: Partial<CanvasLocalDraft> = {}): CanvasLocalDraft {
    return {
        projectId: PROJECT_ID,
        snapshot: { layers: [{ id: "l1", type: "text", text: "hello" }] },
        baseVersion: 5,
        ts: Date.now(),
        ...overrides,
    };
}

beforeEach(() => {
    idbState.clear();
    __resetCanvasLocalBufferForTests();
    // Pretend we're in a browser. The buffer module needs window + indexedDB
    // to attempt to open a store; we mocked idb-keyval so the actual IDB
    // call never fires, but the early-return guard checks `typeof window`.
    vi.stubGlobal("window", {});
    vi.stubGlobal("indexedDB", {});
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("canvasLocalBuffer", () => {
    it("saves and loads a draft round-trip", async () => {
        const draft = makeDraft();
        await saveLocalDraft(draft);
        const loaded = await loadLocalDraft(PROJECT_ID);
        expect(loaded).not.toBeNull();
        expect(loaded?.projectId).toBe(PROJECT_ID);
        expect(loaded?.baseVersion).toBe(5);
        expect(loaded?.snapshot).toEqual(draft.snapshot);
    });

    it("returns null for an unknown projectId", async () => {
        const loaded = await loadLocalDraft("does-not-exist");
        expect(loaded).toBeNull();
    });

    it("evicts drafts older than the TTL on read", async () => {
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
        await saveLocalDraft(makeDraft({ ts: eightDaysAgo }));
        const loaded = await loadLocalDraft(PROJECT_ID);
        expect(loaded).toBeNull();
    });

    it("clearLocalDraft removes the draft", async () => {
        await saveLocalDraft(makeDraft());
        await clearLocalDraft(PROJECT_ID);
        const loaded = await loadLocalDraft(PROJECT_ID);
        expect(loaded).toBeNull();
    });

    it("overwrites prior drafts (only the latest one is kept)", async () => {
        const now = Date.now();
        await saveLocalDraft(makeDraft({ baseVersion: 1, ts: now - 5_000 }));
        await saveLocalDraft(makeDraft({ baseVersion: 7, ts: now }));
        const loaded = await loadLocalDraft(PROJECT_ID);
        expect(loaded?.baseVersion).toBe(7);
        expect(loaded?.ts).toBe(now);
    });

    it("stashRejectedDraft moves the draft into a rejected slot and clears the active key", async () => {
        const ts = Date.now();
        const draft = makeDraft({ ts });
        await saveLocalDraft(draft);
        await stashRejectedDraft(draft);

        // Active slot should be empty (loadLocalDraft also runs the TTL
        // janitor on first call, but the rejected entry's `ts` is fresh
        // so it survives).
        const active = await loadLocalDraft(PROJECT_ID);
        expect(active).toBeNull();

        // Rejected key should be present in the underlying store.
        const rejectedKeys = Array.from(idbState.keys()).filter(
            (k): k is string => typeof k === "string" && k.startsWith("canvas-rejected:"),
        );
        expect(rejectedKeys).toHaveLength(1);
        expect(rejectedKeys[0]).toBe(`canvas-rejected:${PROJECT_ID}:${ts}`);
    });

    it("is a no-op when window/indexedDB are absent (SSR safety)", async () => {
        vi.stubGlobal("window", undefined);
        vi.stubGlobal("indexedDB", undefined);
        __resetCanvasLocalBufferForTests();

        await expect(saveLocalDraft(makeDraft())).resolves.toBeUndefined();
        await expect(loadLocalDraft(PROJECT_ID)).resolves.toBeNull();
        await expect(clearLocalDraft(PROJECT_ID)).resolves.toBeUndefined();
    });
});
