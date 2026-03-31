/**
 * Lightweight canvas save endpoint for navigator.sendBeacon.
 *
 * This endpoint exists because tRPC mutations get aborted during page unload.
 * navigator.sendBeacon guarantees delivery even when the page is closing.
 */
import { prisma } from "@/server/db";
import { auth } from "@/server/auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId, canvasState } = await req.json();

    if (!projectId || !canvasState) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    // Validate canvasState structure — reject empty/invalid saves
    if (!canvasState.layers || !Array.isArray(canvasState.layers)) {
      return NextResponse.json({ error: "Invalid canvas state: missing layers" }, { status: 400 });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        canvasState,
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
