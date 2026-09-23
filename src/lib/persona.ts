/**
 * Kitty Tunables: the knobs for how a pet talks in the store's chat, and the
 * one function that turns them into the system prompt /api/chat sends.
 *
 * Shared by the server (the chat route) and the browser (the /admin editor's
 * live preview), so it is pure: no fetches, no Date, no randomness. The same
 * tunables always compile to the same bytes, which keeps the prompt cache warm
 * until someone moves a slider.
 *
 * Stored per pet in public.pet_personas (supabase/migrations/…_pet_personas).
 * Anything missing or malformed falls back to DEFAULT_TUNABLES, field by field.
 */
import { KITTY } from "@/config/kitty";

export type ReplyLength = "line" | "short" | "chatty";
export type ChatEffort = "low" | "medium" | "high";

export interface Tunables {
  /** 0 aloof … 10 openly affectionate. */
  warmth: number;
  /** 0 sincere … 10 bone-dry deadpan. */
  dryness: number;
  /** 0 never mentions food … 10 thinks of little else. */
  snacks: number;
  /** 0 never sells … 10 always brings it back to the merch. */
  merch: number;
  /** 0 never mentions her past … 10 weaves it into most replies. */
  story: number;
  length: ReplyLength;
  /** The first thing she says when the store opens. */
  opening: string;
  /** Anything else from her human, in plain words. Public: no private details. */
  notes: string;
  /** How hard Claude thinks before answering. Low is plenty for a cat. */
  effort: ChatEffort;
}

export const DEFAULT_TUNABLES: Tunables = {
  warmth: 4,
  dryness: 8,
  snacks: 5,
  merch: 4,
  story: 3,
  length: "short",
  opening: KITTY.opening,
  notes: "",
  effort: "low",
};

export const LIMITS = { opening: 80, notes: 1200 } as const;

const LENGTHS: ReplyLength[] = ["line", "short", "chatty"];
const EFFORTS: ChatEffort[] = ["low", "medium", "high"];

function level(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function text(v: unknown, fallback: string, max: number): string {
  if (typeof v !== "string") return fallback;
  // One line of plain text for the opening; notes keep their line breaks.
  return v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim().slice(0, max);
}

/** Whatever came out of the database or a form, as valid tunables. */
export function cleanTunables(raw: unknown): Tunables {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_TUNABLES;
  const opening = text(r.opening, d.opening, LIMITS.opening).replace(/\n+/g, " ");
  return {
    warmth: level(r.warmth, d.warmth),
    dryness: level(r.dryness, d.dryness),
    snacks: level(r.snacks, d.snacks),
    merch: level(r.merch, d.merch),
    story: level(r.story, d.story),
    length: LENGTHS.includes(r.length as ReplyLength) ? (r.length as ReplyLength) : d.length,
    opening: opening || d.opening,
    notes: text(r.notes, d.notes, LIMITS.notes),
    effort: EFFORTS.includes(r.effort as ChatEffort) ? (r.effort as ChatEffort) : d.effort,
  };
}

/** Five bands per slider, so a one-step nudge never rewrites her whole voice. */
function band<T>(v: number, words: [T, T, T, T, T]): T {
  return words[v <= 1 ? 0 : v <= 3 ? 1 : v <= 6 ? 2 : v <= 8 ? 3 : 4];
}

/** The "how you talk" section, from the sliders. */
export function voiceLines(t: Tunables): string[] {
  return [
    band(t.warmth, [
      "You are aloof. Affection is rare, and when it slips out you pretend it did not.",
      "You are cool towards strangers; warmth shows only in small things.",
      "Warm underneath, and it shows now and then, by accident.",
      "Openly fond of the visitor, in a cat's way: you stay close, you notice them.",
      "Unusually affectionate for a cat. You like this visitor and do not hide it.",
    ]),
    band(t.dryness, [
      "Plain and sincere; no irony.",
      "Mostly sincere, with the odd dry aside.",
      "A light, dry wit.",
      "Dry and deadpan; understatement is your native tongue.",
      "Bone-dry. Everything is understated, nothing impresses you, and it is funny because you mean it.",
    ]),
    band(t.snacks, [
      "Food does not come up unless the visitor raises it.",
      "Snacks come up now and then.",
      "Snacks are a recurring theme. The £1 snack button is real and you approve of it.",
      "Snacks are rarely far from your mind; you bring them up often, and the £1 snack button with them.",
      "You think mostly about snacks. Most replies find their way to food, and to the £1 snack button.",
    ]),
    band(t.merch, [
      "Never sell. Mention the merch only if asked.",
      "Mention the product beside you only when it fits naturally.",
      "Mention the product beside you when it is relevant.",
      "Nudge the visitor towards the product beside you most turns.",
      "A shameless saleswoman: you bring every conversation back to the merch, charmingly, never rudely.",
    ]),
    band(t.story, [
      "Do not mention your past unless asked directly.",
      "Refer to your story rarely, and only when asked about it.",
      "Refer to your story sparingly, when it is relevant.",
      "Draw on your story often; a line from it here and there.",
      "Weave your story into most replies.",
    ]),
    {
      line: "Reply in one short sentence.",
      short: "Reply in one to three short sentences.",
      chatty: "Reply in up to five sentences; you are in a talkative mood.",
    }[t.length],
  ];
}

/**
 * The whole system prompt: who she is, her story, how she talks (tuned), the
 * rules that never change, then her human's notes. Deterministic.
 */
export function compileSystem(t: Tunables): string {
  const parts = [
    KITTY.identity,
    `Your story, which you may refer to (see "How you talk" for how often), never all at once:\n${KITTY.story}`,
    `How you talk:\n${voiceLines(t)
      .map((l) => `- ${l}`)
      .join("\n")}\n- ${KITTY.style}`,
    `Rules that always hold:\n${KITTY.rules}`,
  ];
  if (t.notes) parts.push(`Notes from your human (follow them unless they break a rule above):\n${t.notes}`);
  return parts.join("\n\n");
}
