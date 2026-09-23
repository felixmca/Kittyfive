"use client";
/**
 * Story subscriptions in the browser (Phase 5). Live mode goes through
 * Supabase with the visitor's own session (subscribe_me / unsubscribe_me,
 * RLS for reading) and through /api/subscriptions for anything that sends
 * email. Demo mode keeps everything in this browser and sends nothing, so
 * every screen works (and is verified) without a backend.
 */
import { accessToken } from "@/lib/auth/store";
import { browserSupabase, liveMode } from "@/lib/supabase/browser";

export type SubStatus = "pending" | "active" | "unsubscribed" | "bounced";

export interface Subscriber {
  id: string;
  email: string;
  status: SubStatus;
  source: "self" | "invite";
  createdAt: string;
}

export interface SendResult {
  ok: boolean;
  message: string;
  /** Demo mode: nothing was sent. */
  demo?: boolean;
}

const DEMO_KEY = "kittyfive-demo-subscriptions-v1";

interface DemoState {
  /** petId → subscribers. The demo reader is "you@example.com". */
  subs: Record<string, Subscriber[]>;
  /** chapterId → when it was "emailed". */
  notified: Record<string, string>;
}

export const DEMO_READER = "you@example.com";

function demoRead(): DemoState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "null") as DemoState | null;
    if (raw && typeof raw === "object" && raw.subs && raw.notified) return raw;
  } catch {
    /* fall through */
  }
  return { subs: {}, notified: {} };
}

function demoWrite(s: DemoState): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(s));
  } catch {
    /* private mode: the demo forgets */
  }
}

function demoUpsert(petId: string, email: string, patch: Partial<Subscriber>, source: Subscriber["source"]): Subscriber {
  const s = demoRead();
  const list = (s.subs[petId] ??= []);
  let row = list.find((r) => r.email === email);
  if (!row) {
    row = { id: `demo-${Date.now().toString(36)}-${list.length}`, email, status: "pending", source, createdAt: new Date().toISOString() };
    list.push(row);
  }
  Object.assign(row, patch);
  demoWrite(s);
  return row;
}

/** The signed-in reader's own subscription to a pet (null: none). */
export async function mySubscription(petId: string, userId: string | null): Promise<SubStatus | null> {
  if (!liveMode()) {
    return demoRead().subs[petId]?.find((r) => r.email === DEMO_READER)?.status ?? null;
  }
  if (!userId) return null;
  const { data, error } = await browserSupabase()
    .from("story_subscriptions")
    .select("status")
    .eq("pet_id", petId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { status?: SubStatus } | null)?.status ?? null) as SubStatus | null;
}

export async function subscribe(petId: string): Promise<SubStatus> {
  if (!liveMode()) {
    return demoUpsert(petId, DEMO_READER, { status: "active" }, "self").status;
  }
  const { error } = await browserSupabase().rpc("subscribe_me", { p_pet: petId });
  if (error) throw new Error(error.code === "28000" ? "Confirm your email address first (check your inbox)." : error.message);
  return "active";
}

export async function unsubscribe(petId: string): Promise<SubStatus> {
  if (!liveMode()) {
    return demoUpsert(petId, DEMO_READER, { status: "unsubscribed" }, "self").status;
  }
  const { error } = await browserSupabase().rpc("unsubscribe_me", { p_pet: petId });
  if (error) throw new Error(error.message);
  return "unsubscribed";
}

// ─── owners ─────────────────────────────────────────────────────────────────

export async function listSubscribers(petId: string): Promise<Subscriber[]> {
  if (!liveMode()) return demoRead().subs[petId] ?? [];
  const { data, error } = await browserSupabase()
    .from("story_subscriptions")
    // Every column but the token (which nobody can read).
    .select("id, email, status, source, created_at")
    .eq("pet_id", petId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as { id: string; email: string; status: SubStatus; source: Subscriber["source"]; created_at: string };
    return { id: row.id, email: row.email, status: row.status, source: row.source, createdAt: row.created_at };
  });
}

/** Which chapters have been emailed, and when. */
export async function notifiedChapters(petId: string): Promise<Record<string, string>> {
  if (!liveMode()) return demoRead().notified;
  const { data, error } = await browserSupabase()
    .from("chapters")
    .select("id, notified_at")
    .eq("pet_id", petId)
    .not("notified_at", "is", null);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; notified_at: string }[]) out[r.id] = r.notified_at;
  return out;
}

/** Can this site send email? Demo mode says yes (it pretends, and says so). */
export async function canSendEmail(): Promise<boolean> {
  if (!liveMode()) return true;
  try {
    const res = await fetch("/api/subscriptions/status", { cache: "no-store" });
    return Boolean(((await res.json()) as { email?: boolean }).email);
  } catch {
    return false;
  }
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const token = await accessToken();
  // No answer in time (a weak signal): a plain failure the panel can report.
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch {
    return { ok: false, data: { message: "No answer. Check your connection and try again." } };
  } finally {
    window.clearTimeout(timer);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return { ok: res.ok, data };
}

export async function invite(petId: string, email: string): Promise<SendResult> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, message: "That doesn't look like an email address." };
  if (!liveMode()) {
    const existing = demoRead().subs[petId]?.find((r) => r.email === clean);
    if (existing && existing.status !== "pending") {
      return { ok: true, demo: true, message: existing.status === "active" ? "Already subscribed." : "They said no before, so no invitation." };
    }
    demoUpsert(petId, clean, {}, "invite");
    return { ok: true, demo: true, message: `Invitation ready for ${clean} (demo: nothing was sent).` };
  }
  const { ok, data } = await post("/api/subscriptions/invite", { petId, email: clean }, 20_000);
  if (!ok) return { ok: false, message: String(data.message ?? "That didn't work.") };
  const status = data.status as SubStatus;
  if (status === "active") return { ok: true, message: "Already subscribed." };
  if (status === "unsubscribed" || status === "bounced") return { ok: true, message: "They said no before, so no invitation." };
  return { ok: true, message: data.sent ? `Invitation sent to ${clean}.` : "Saved, but the email did not go. Try again later." };
}

export async function notifyChapter(petId: string, chapterId: string): Promise<SendResult> {
  if (!liveMode()) {
    const s = demoRead();
    if (s.notified[chapterId]) return { ok: false, demo: true, message: "Already emailed." };
    const n = (s.subs[petId] ?? []).filter((r) => r.status === "active").length;
    s.notified[chapterId] = new Date().toISOString();
    demoWrite(s);
    return { ok: true, demo: true, message: `Would email ${n} ${n === 1 ? "subscriber" : "subscribers"} (demo: nothing was sent).` };
  }
  // The route may take up to its 60 s limit for a long list.
  const { ok, data } = await post("/api/subscriptions/notify", { chapterId }, 70_000);
  if (!ok) return { ok: false, message: String(data.message ?? "That didn't work.") };
  const n = Number(data.recipients ?? 0);
  const sent = Number(data.sent ?? 0);
  return { ok: true, message: n === 0 ? "Nobody to email yet." : `Emailed ${sent} of ${n}.` };
}
