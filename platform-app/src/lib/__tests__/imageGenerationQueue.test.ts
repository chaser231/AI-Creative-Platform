import { afterEach, describe, expect, it, vi } from "vitest";
import {
    _resetImageGenerationQueueForTests,
    enqueueImageGeneration,
    getProjectQueueCounts,
    subscribeImageGenerationJobs,
} from "@/lib/imageGenerationQueue";

afterEach(() => {
    _resetImageGenerationQueueForTests();
    vi.useRealTimers();
});

describe("imageGenerationQueue", () => {
    it("runs up to 4 jobs in parallel per project", async () => {
        let running = 0;
        let maxRunning = 0;
        const gate = Promise.withResolvers<void>();

        const makeRunner = () => async () => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await gate.promise;
            running -= 1;
        };

        for (let i = 0; i < 6; i++) {
            enqueueImageGeneration(
                {
                    id: `job-${i}`,
                    projectId: "p1",
                    surface: "photo",
                    prompt: `prompt ${i}`,
                    imageCount: 1,
                },
                makeRunner(),
            );
        }

        await vi.waitFor(() => {
            expect(maxRunning).toBe(4);
            expect(getProjectQueueCounts("p1").queued).toBe(2);
        });

        gate.resolve();
        await vi.waitFor(() => {
            expect(getProjectQueueCounts("p1").running).toBe(0);
            expect(getProjectQueueCounts("p1").queued).toBe(0);
        });

        expect(maxRunning).toBe(4);
    });

    it("keeps excess jobs queued until a slot is free", async () => {
        const gate = Promise.withResolvers<void>();
        for (let i = 0; i < 5; i++) {
            enqueueImageGeneration(
                {
                    id: `job-${i}`,
                    projectId: "p2",
                    surface: "studio",
                    prompt: "x",
                    imageCount: 1,
                },
                async () => {
                    await gate.promise;
                },
            );
        }

        await vi.waitFor(() => getProjectQueueCounts("p2").queued === 1);
        expect(getProjectQueueCounts("p2").running).toBe(4);
    });

    it("notifies subscribers on status changes", async () => {
        const seen: string[] = [];
        const unsubscribe = subscribeImageGenerationJobs((jobs) => {
            seen.push(jobs.map((j) => j.status).join(","));
        });

        enqueueImageGeneration(
            {
                id: "job-a",
                projectId: "p3",
                surface: "wizard",
                prompt: "cat",
                imageCount: 1,
            },
            async () => undefined,
        );

        await vi.waitFor(() => seen.some((s) => s.includes("completed")));

        unsubscribe();
    });
});
