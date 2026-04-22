/**
 * Lightweight canvas save endpoint for navigator.sendBeacon.
 *
 * This endpoint exists because tRPC mutations get aborted during page unload.
 * navigator.sendBeacon guarantees delivery even when the page is closing.
 */
import { prisma } from "@/server/db";
import { auth } from "@/server/auth";
import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import { requireSessionAndProjectAccess } from "@/server/authz/guards";

function trpcErrorResponse(e: unknown) {
  if (e instanceof TRPCError) {
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e.code === "NOT_FOUND") {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json({ error: e.message ?? "Internal error" }, { status: 500 });
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId, canvasState, thumbnail } = await req.json();

    if (!projectId || !canvasState) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    // Validate canvasState structure — reject empty/invalid saves
    if (!canvasState.layers || !Array.isArray(canvasState.layers)) {
      return NextResponse.json({ error: "Invalid canvas state: missing layers" }, { status: 400 });
    }

    try {
      await requireSessionAndProjectAccess(session.user.id, projectId, "write");
    } catch (e) {
      const res = trpcErrorResponse(e);
      if (res) return res;
      throw e;
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        canvasState,
        ...(thumbnail !== undefined && { thumbnail }),
        status: "IN_PROGRESS",
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("Canvas beacon save failed:", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
