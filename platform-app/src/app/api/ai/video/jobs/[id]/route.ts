/**
 * GET /api/ai/video/jobs/[id] — poll an async video generation job.
 *
 * Performs one non-blocking fal queue status check. On completion the
 * winning poll persists the video to S3, creates the library Asset and the
 * AIMessage, then flips the job to COMPLETED (see server/video/jobs.ts).
 * Concurrent polls are safe — the PERSISTING claim makes persist idempotent.
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { syncVideoJob, toVideoJobView } from "@/server/video/jobs";

// Persisting a long 1080p video to S3 can take a while on cold start.
export const maxDuration = 180;

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { id } = await params;

        const job = await prisma.videoJob.findUnique({ where: { id } });
        if (!job || job.userId !== session.user.id) {
            return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }

        const synced = await syncVideoJob(job);
        return NextResponse.json({ job: toVideoJobView(synced) });
    } catch (error: unknown) {
        const err = error as Error;
        console.error("[/api/ai/video/jobs]", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
