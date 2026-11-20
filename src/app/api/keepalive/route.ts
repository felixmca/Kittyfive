/**
 * GET /api/keepalive -> { ok, at }
 *
 * Since 20 November 2026 the Supabase project sits in a Free organisation
 * (« Kittyfive »), and Free pauses a project after a week without activity.
 * Vercel's daily cron (vercel.json) calls this route: one anonymous read of
 * the public pet, which anyone may read anyway, keeps the database awake.
 * Move the project back to a paid organisation before the first sale
 * (docs/GO-LIVE.md, Step 8); this route can stay.
 */
import { connection, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  await connection();
  const sb = serverSupabase();
  if (!sb) {
    return NextResponse.json({ ok: false, reason: "demo mode" }, { headers: { "Cache-Control": "no-store" } });
  }
  const { error } = await sb.from("pets").select("id").eq("is_public", true).limit(1);
  return NextResponse.json(
    { ok: !error, at: new Date().toISOString() },
    { status: error ? 502 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
