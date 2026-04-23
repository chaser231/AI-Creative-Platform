/**
 * Lightweight canvas save endpoint for navigator.sendBeacon.
 *
 * This endpoint exists because tRPC mutations get aborted during page unload.
 * navigator.sendBeacon guarantees delivery even when the page is closing.
 *
 * MF-3 — optimistic-locking-aware, but SOFT:
 *   - Tab has ~100 ms in unload/pagehide; we can't surface a conflict dialog
 *     nor run a refetch/merge loop — the user is already navigating away.
 *   - Losing unsaved work is strictly worse than overwriting a slightly newer
 *     version, so on version mismatch we log a warning and still persist the
 *     save (last-wins fallback), signalling `conflict: true` in the response.
 *   - The interactive tRPC path (`project.saveState`) remains strict and
 *     throws CONFLICT — that's where the client has time to recover.
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

    const body = await req.json();
    const { projectId, canvasState, thumbnail } = body ?? {};
    const expectedVersion: number | undefined =
      typeof body?.expectedVersion === "number" && Number.isFinite(body.expectedVersion)
        ? body.expectedVersion
        : undefined;

    if (!projectId || !canvasState) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

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

    let conflict = false;
    if (expectedVersion !== undefined) {
      const current = await prisma.project.findUnique({
        where: { id: projectId },
        select: { version: true },
      });
      if (current && current.version !== expectedVersion) {
        conflict = true;
        console.warn(
          `[canvas/save] beacon version conflict: projectId=${projectId}, client=${expectedVersion}, server=${current.version} — applying last-wins fallback`
        );
      }
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        canvasState,
        ...(thumbnail !== undefined && { thumbnail }),
        status: "IN_PROGRESS",
        updatedAt: new Date(),
        version: { increment: 1 },
      },
      select: { version: true },
    });

    return NextResponse.json({ ok: true, version: updated.version, ...(conflict && { conflict: true }) });
  } catch (err) {
    console.warn("Canvas beacon save failed:", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
