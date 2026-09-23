/**
 * POST /api/story-report — one anonymous, technical summary of how the
 * landing story went on a visitor's device (sent with navigator.sendBeacon
 * when the page is hidden), or a "stalled" note when it never started.
 * See src/components/landing/SwipeStory/report.ts for what is in it, and
 * supabase/migrations/20260923072442_story_reports.sql for where it goes.
 *
 * Only known fields of known types are kept, strings are clipped, and the
 * database function caps the table, so this cannot be used to store anything
 * else. No IP address is stored (it is only used here, in memory, to rate
 * limit).
 */
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { serverSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BODY = 6000;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const STRINGS: Record<string, number> = { build: 16, ua: 300, screen: 32, endMode: 12, page: 64 };
const NUMBERS = [
  "v",
  "startMs",
  "furthest",
  "swipes",
  "peakDecoded",
  "decoded",
  "broken",
  "fetched",
  "finals",
  "visibleMs",
  "memory",
  "t",
  "flushes",
  "waitMs",
  "skips",
];
const BOOLEANS = ["started", "splash", "reduced", "standalone", "drawFailed", "crashedBefore", "released"];

function clean(input: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, max] of Object.entries(STRINGS)) {
    const v = input[key];
    if (typeof v === "string") out[key] = v.slice(0, max);
  }
  for (const key of NUMBERS) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.round(v * 100) / 100;
  }
  for (const key of BOOLEANS) {
    const v = input[key];
    if (typeof v === "boolean") out[key] = v;
  }
  if (Array.isArray(input.errors)) {
    out.errors = input.errors
      .filter((e): e is string => typeof e === "string")
      .slice(0, 4)
      .map((e) => e.slice(0, 200));
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(`story-report:${clientKey(req)}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!limited.ok) return new Response(null, { status: 429 });
  const text = await req.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let body: { kind?: unknown; report?: unknown };
  try {
    body = JSON.parse(text) as { kind?: unknown; report?: unknown };
  } catch {
    return new Response(null, { status: 400 });
  }
  const kind = body.kind === "stalled" ? "stalled" : body.kind === "summary" ? "summary" : null;
  if (!kind || !body.report || typeof body.report !== "object" || Array.isArray(body.report)) {
    return new Response(null, { status: 400 });
  }
  const report = clean(body.report as Record<string, unknown>);
  const sb = serverSupabase();
  if (!sb) return new Response(null, { status: 204 }); // demo mode: nowhere to keep it
  const { error } = await sb.rpc("report_story", { kind, report });
  if (error) console.warn("[story-report] not stored:", error.message);
  return new Response(null, { status: 204 });
}
