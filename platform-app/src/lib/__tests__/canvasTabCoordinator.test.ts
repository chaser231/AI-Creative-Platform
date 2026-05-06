import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
    createCanvasCoordinator,
    type CoordinatorMessage,
} from "../canvasTabCoordinator";

// ─── Test doubles ──────────────────────────────────────────────────────────
// Simulate a tiny in-process BroadcastChannel network so two coordinator
// instances created against the same `projectId` see each other's posts.

type ChannelPeer = {
    name: string;
    listeners: Set<(event: MessageEvent) => void>;
};

const channelRegistry = new Map<string, Set<ChannelPeer>>();

class FakeBroadcastChannel {
    name: string;
    private peer: ChannelPeer;
    private listeners = new Set<(event: MessageEvent) => void>();
    private closed = false;

    constructor(name: string) {
        this.name = name;
        this.peer = { name, listeners: this.listeners };
        if (!channelRegistry.has(name)) channelRegistry.set(name, new Set());
        channelRegistry.get(name)!.add(this.peer);
    }

    postMessage(data: unknown) {
        if (this.closed) return;
        const peers = channelRegistry.get(this.name);
        if (!peers) return;
        for (const peer of peers) {
            // BroadcastChannel spec: never echo to self.
            if (peer === this.peer) continue;
            for (const listener of peer.listeners) {
                queueMicrotask(() => listener({ data } as MessageEvent));
            }
        }
    }

    addEventListener(_event: "message", listener: (event: MessageEvent) => void) {
        this.listeners.add(listener);
    }

    removeEventListener(_event: "message", listener: (event: MessageEvent) => void) {
        this.listeners.delete(listener);
    }

    close() {
        this.closed = true;
        const peers = channelRegistry.get(this.name);
        peers?.delete(this.peer);
        this.listeners.clear();
    }
}

// ─── navigator.locks fake ──────────────────────────────────────────────────
// FIFO single-resource lock. `request(name, opts, cb)` resolves cb with the
// lock once any prior holder releases. The callback's returned Promise gates
// release — that's exactly the contract the coordinator relies on.

class FakeLockManager {
    private holders = new Map<string, Promise<unknown>>();

    async request<T>(
        name: string,
        _opts: { mode: "exclusive" | "shared" },
        callback: (lock: { name: string }) => Promise<T>,
    ): Promise<T> {
        const prev = this.holders.get(name) ?? Promise.resolve();
        let resolveSlot: (value: T) => void = () => {};
        let rejectSlot: (err: unknown) => void = () => {};
        const slot = new Promise<T>((resolve, reject) => {
            resolveSlot = resolve;
            rejectSlot = reject;
        });

        const wait = prev.then(async () => {
            try {
                const result = await callback({ name });
                resolveSlot(result);
            } catch (err) {
                rejectSlot(err);
            }
        });
        this.holders.set(name, wait);

        return slot;
    }
}

let fakeLocks: FakeLockManager;

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    channelRegistry.clear();
    fakeLocks = new FakeLockManager();

    // Node 22+ exposes `navigator` and `window` as read-only getters on
    // globalThis. `vi.stubGlobal` handles the property descriptor dance
    // for us so we can swap them per-test.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { locks: fakeLocks });
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("createCanvasCoordinator — leader election", () => {
    it("first tab becomes leader; second tab waits as follower", async () => {
        const projectId = "project-A";
        const tabA = createCanvasCoordinator(projectId);
        const tabB = createCanvasCoordinator(projectId);

        await flushMicrotasks();

        expect(tabA.isLeader()).toBe(true);
        expect(tabB.isLeader()).toBe(false);

        tabA.destroy();
        tabB.destroy();
    });

    it("releaseLead hands the lock off to the waiting follower", async () => {
        const projectId = "project-B";
        const tabA = createCanvasCoordinator(projectId);
        const tabB = createCanvasCoordinator(projectId);

        await flushMicrotasks();
        expect(tabA.isLeader()).toBe(true);
        expect(tabB.isLeader()).toBe(false);

        tabA.releaseLead();
        await flushMicrotasks();

        expect(tabA.isLeader()).toBe(false);
        expect(tabB.isLeader()).toBe(true);

        tabA.destroy();
        tabB.destroy();
    });

    it("requestLead from a follower triggers leader to release", async () => {
        const projectId = "project-C";
        const tabA = createCanvasCoordinator(projectId);
        const tabB = createCanvasCoordinator(projectId);

        await flushMicrotasks();
        expect(tabA.isLeader()).toBe(true);

        tabB.requestLead();
        await flushMicrotasks();
        await flushMicrotasks(); // one tick for postMessage delivery, one for lock handoff

        expect(tabA.isLeader()).toBe(false);
        expect(tabB.isLeader()).toBe(true);

        tabA.destroy();
        tabB.destroy();
    });

    it("destroy() releases the lock", async () => {
        const projectId = "project-D";
        const tabA = createCanvasCoordinator(projectId);
        const tabB = createCanvasCoordinator(projectId);

        await flushMicrotasks();
        expect(tabA.isLeader()).toBe(true);

        tabA.destroy();
        await flushMicrotasks();

        expect(tabB.isLeader()).toBe(true);

        tabB.destroy();
    });

    it("falls back to single-tab leader mode when navigator.locks is missing", async () => {
        vi.stubGlobal("navigator", {});

        const tab = createCanvasCoordinator("project-no-locks");
        expect(tab.isLeader()).toBe(true);

        tab.destroy();
    });
});

describe("createCanvasCoordinator — message relay", () => {
    it("delivers postMessage to other tabs but not to self", async () => {
        const projectId = "project-msg";
        const tabA = createCanvasCoordinator(projectId);
        const tabB = createCanvasCoordinator(projectId);

        await flushMicrotasks();

        const aSeen: CoordinatorMessage[] = [];
        const bSeen: CoordinatorMessage[] = [];
        tabA.onMessage((m) => aSeen.push(m));
        tabB.onMessage((m) => bSeen.push(m));

        tabA.postMessage({ type: "saved", version: 7, ts: 1, tabId: tabA.tabId });
        await flushMicrotasks();

        expect(aSeen).toHaveLength(0); // never echoed to self
        expect(bSeen).toHaveLength(1);
        expect(bSeen[0]).toMatchObject({ type: "saved", version: 7 });

        tabA.destroy();
        tabB.destroy();
    });

    it("onLeaderChange fires the current value synchronously on subscribe", async () => {
        const projectId = "project-sub";
        const tab = createCanvasCoordinator(projectId);
        await flushMicrotasks();

        const seen: boolean[] = [];
        tab.onLeaderChange((v) => seen.push(v));

        expect(seen).toEqual([true]);

        tab.destroy();
    });
});

describe("createCanvasCoordinator — robustness", () => {
    it("listener exceptions don't kill subsequent listeners", async () => {
        const projectId = "project-robust";
        const tab = createCanvasCoordinator(projectId);
        await flushMicrotasks();

        const okListener = vi.fn();
        tab.onLeaderChange(() => {
            throw new Error("boom");
        });
        tab.onLeaderChange(okListener);

        tab.releaseLead();
        await flushMicrotasks();

        // okListener should have fired despite the prior listener throwing.
        // Counts: 1 sync-on-subscribe call + 1 transition call.
        expect(okListener).toHaveBeenCalledTimes(2);

        tab.destroy();
    });
});
