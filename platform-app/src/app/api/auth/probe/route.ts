import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { probeDatabaseSessionFromHeaders } from "@/server/auth/sessionProbe";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const result = await probeDatabaseSessionFromHeaders(request.headers, prisma);

    if (result.status === "authenticated") {
      return NextResponse.json({ status: "authenticated" });
    }

    return NextResponse.json({
      status: "unauthenticated",
      reason: result.status === "missing_cookie" ? "missing_cookie" : result.reason,
    });
  } catch (err) {
    console.error("[auth/probe] Failed to verify session cookie:", (err as Error)?.message);
    return NextResponse.json(
      { status: "unknown", reason: "session_check_failed" },
      { status: 503 },
    );
  }
}
