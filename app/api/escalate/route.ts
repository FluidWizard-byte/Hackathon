import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("reason" in body) || body.reason !== "sos") return NextResponse.json({ error: "reason must be sos" }, { status: 400 });
    await requireRole("worker");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
