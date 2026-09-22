/**
 * GET /api/commerce/status -> { mode, stripe, supabase, pod, email, selfcheck? }
 * No secrets: booleans only. In demo mode the config self-check is attached.
 */
import { connection, NextResponse } from "next/server";
import { status } from "@/lib/commerce";
import { runSelfCheck } from "@/lib/commerce/selfcheck";

export const runtime = "nodejs";

export async function GET() {
  await connection();
  const s = status();
  const body = s.mode === "demo" ? { ...s, selfcheck: runSelfCheck() } : s;
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
