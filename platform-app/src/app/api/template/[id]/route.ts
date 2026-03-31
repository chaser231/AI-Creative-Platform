/**
 * GET /api/template/[id] — returns full template with data field.
 * Simple REST endpoint to avoid complex tRPC batch URL encoding.
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const template = await prisma.template.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Increment popularity
    await prisma.template.update({
      where: { id },
      data: { popularity: { increment: 1 } },
    });

    return NextResponse.json(template);
  } catch (err) {
    console.error("Template fetch failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
