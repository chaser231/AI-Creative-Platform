/**
 * GET /api/template/[id] — returns full template with data field.
 * Simple REST endpoint to avoid complex tRPC batch URL encoding.
 */
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";

const MAX_RESPONSE_BYTES = 3_200_000;

function stripBase64FromLayers(layers: any[]): any[] {
  return layers.map((l: any) => {
    if (l.type === "image" && typeof l.src === "string" && l.src.startsWith("data:")) {
      return { ...l, src: "" };
    }
    return l;
  });
}

function compactTemplateData(data: Record<string, unknown>): Record<string, unknown> {
  const raw = JSON.stringify(data);
  if (raw.length <= MAX_RESPONSE_BYTES) return data;

  console.warn(`[template API] data is ${(raw.length / 1024 / 1024).toFixed(2)} MB — stripping inline base64`);
  const result = { ...data };

  if (Array.isArray(result.layers)) {
    result.layers = stripBase64FromLayers(result.layers as any[]);
  }
  if (Array.isArray(result.resizes)) {
    result.resizes = (result.resizes as any[]).map((r: any) => ({
      ...r,
      layerSnapshot: Array.isArray(r.layerSnapshot)
        ? stripBase64FromLayers(r.layerSnapshot)
        : r.layerSnapshot,
    }));
  }
  return result;
}

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

    await prisma.template.update({
      where: { id },
      data: { popularity: { increment: 1 } },
    }).catch(() => {});

    if (template.data && typeof template.data === "object") {
      (template as any).data = compactTemplateData(template.data as Record<string, unknown>);
    }

    return NextResponse.json(template);
  } catch (err) {
    console.error("Template fetch failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
