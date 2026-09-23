"use client";
/**
 * Kitty Tunables on /admin: how Kitty talks in the store's chat.
 *
 * Five sliders (warmth, dryness, snacks, merch, her story), reply length,
 * effort, her opening line and free notes. Under each slider is the exact
 * sentence it puts into her system prompt, and the whole compiled prompt is
 * one tap away, so what you set is what she is told. Saved per pet in
 * public.pet_personas (RLS: editors write, anyone reads); /api/chat picks a
 * change up within a minute. Demo mode saves in this browser only.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TUNABLES,
  LIMITS,
  cleanTunables,
  compileSystem,
  voiceLines,
  type ChatEffort,
  type ReplyLength,
  type Tunables,
} from "@/lib/persona";
import { fetchTunables, saveTunables } from "@/lib/personaClient";

type Slider = "warmth" | "dryness" | "snacks" | "merch" | "story";

const SLIDERS: { key: Slider; label: string; low: string; high: string }[] = [
  { key: "warmth", label: "Warmth", low: "Aloof", high: "Affectionate" },
  { key: "dryness", label: "Dryness", low: "Sincere", high: "Bone-dry" },
  { key: "snacks", label: "Snack obsession", low: "Never", high: "Constant" },
  { key: "merch", label: "Merch pushiness", low: "Never sells", high: "Shameless" },
  { key: "story", label: "Story references", low: "Never", high: "Every reply" },
];

const LENGTHS: { value: ReplyLength; label: string }[] = [
  { value: "line", label: "One line" },
  { value: "short", label: "Short" },
  { value: "chatty", label: "Chatty" },
];

const EFFORTS: { value: ChatEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const LABEL = "text-[11px] font-medium uppercase tracking-[0.18em] text-muted";
// 16 px on phones: iOS Safari zooms the page into any text field smaller than that.
const FIELD =
  "mt-2 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[16px] sm:text-[15px] text-fg outline-none transition-colors placeholder:text-muted/70 focus:border-accent/60";

function same(a: Tunables, b: Tunables): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function TunablesEditor({ petId, petSlug, petName }: { petId: string | null; petSlug: string; petName: string }) {
  const [saved, setSaved] = useState<Tunables | null>(null);
  const [draft, setDraft] = useState<Tunables>(DEFAULT_TUNABLES);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTunables(petSlug)
      .then((r) => {
        if (cancelled) return;
        setSaved(r.tunables);
        setDraft(r.tunables);
        setState("idle");
        setMessage(r.saved ? null : `${petName} is on her defaults. Move anything and save to make it yours.`);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState("error");
        setMessage(`Could not load her tunables: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [petSlug, petName]);

  const lines = useMemo(() => voiceLines(draft), [draft]);
  const prompt = useMemo(() => compileSystem(draft), [draft]);
  const dirty = saved !== null && !same(cleanTunables(draft), saved);

  const set = <K extends keyof Tunables>(key: K, value: Tunables[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (state === "error") setState("idle");
  };

  async function save() {
    if (!petId) {
      setState("error");
      setMessage(`${petName}'s record is not loaded yet; try again in a moment.`);
      return;
    }
    setState("saving");
    setMessage(null);
    const clean = cleanTunables(draft);
    try {
      await saveTunables(petId, petSlug, clean);
      setSaved(clean);
      setDraft(clean);
      setState("idle");
      setMessage("Saved. The chat picks it up within a minute.");
    } catch (e) {
      setState("error");
      setMessage(`That did not save: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  if (state === "loading") return <p className="text-[14px] text-muted">Loading her tunables…</p>;

  return (
    <div className="flex flex-col gap-6" data-tunables>
      <p className="text-[14px] leading-relaxed text-muted">
        How {petName} talks in the store&apos;s chat. Under each slider is the exact line it puts in her instructions.
        Anyone can read these settings, so keep private details out of the notes.
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        {SLIDERS.map((s, i) => (
          <div key={s.key} data-tunable={s.key}>
            <div className="flex items-baseline justify-between gap-3">
              <label className={LABEL} htmlFor={`tun-${s.key}`}>
                {s.label}
              </label>
              <span className="font-display text-[18px] leading-none text-fg">{draft[s.key]}</span>
            </div>
            <input
              id={`tun-${s.key}`}
              type="range"
              min={0}
              max={10}
              step={1}
              value={draft[s.key]}
              onChange={(e) => set(s.key, Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
              aria-valuetext={`${draft[s.key]} of 10: ${lines[i]}`}
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted">
              <span>{s.low}</span>
              <span>{s.high}</span>
            </div>
            <p className="mt-2 text-[13px] leading-snug text-fg/80" data-tunable-line>
              {lines[i]}
            </p>
          </div>
        ))}

        <div>
          <p className={LABEL}>Reply length</p>
          <Segmented
            name="length"
            options={LENGTHS}
            value={draft.length}
            onChange={(v) => set("length", v)}
          />
          <p className="mt-2 text-[13px] leading-snug text-fg/80">{lines[5]}</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="tun-opening">
            Opening line
          </label>
          <input
            id="tun-opening"
            className={FIELD}
            value={draft.opening}
            maxLength={LIMITS.opening}
            onChange={(e) => set("opening", e.target.value)}
            placeholder={DEFAULT_TUNABLES.opening}
          />
          <p className="mt-2 text-[12px] text-muted">The first thing she says when the store opens.</p>
        </div>
        <div>
          <p className={LABEL}>Effort</p>
          <Segmented name="effort" options={EFFORTS} value={draft.effort} onChange={(v) => set("effort", v)} />
          <p className="mt-2 text-[12px] leading-snug text-muted">
            How hard Claude thinks before she answers. Low is plenty for a cat; higher is slower and costs more.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label className={LABEL} htmlFor="tun-notes">
            Notes from you
          </label>
          <span className="text-[11px] text-muted">
            {draft.notes.length}/{LIMITS.notes}
          </span>
        </div>
        <textarea
          id="tun-notes"
          className={`${FIELD} min-h-[110px] resize-y leading-relaxed`}
          value={draft.notes}
          maxLength={LIMITS.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything else, in plain words. e.g. She has opinions about the heron on the river. She ignores the word 'cute'."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving" || !dirty}
          data-tunables-save
          className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_TUNABLES)}
          disabled={same(draft, DEFAULT_TUNABLES)}
          className="rounded-full border border-white/15 px-5 py-2.5 text-[15px] text-fg transition-colors hover:border-white/35 disabled:opacity-40"
        >
          Back to defaults
        </button>
        <Link href="/store" className="text-[14px] text-accent underline-offset-4 hover:underline">
          Talk to her in the store →
        </Link>
      </div>
      {message ? (
        <p role="status" className={`text-[14px] ${state === "error" ? "text-[#ff9b8a]" : "text-fg/80"}`} data-tunables-status>
          {message}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          aria-expanded={showPrompt}
          className="text-[14px] text-fg/80 underline-offset-4 hover:text-fg hover:underline"
        >
          {showPrompt ? "Hide" : "Show"} her full instructions
        </button>
        {showPrompt ? (
          <pre
            className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/40 p-4 text-[12.5px] leading-relaxed text-fg/85"
            data-tunables-prompt
            data-lenis-prevent
          >
            {prompt}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mt-2 flex rounded-xl border border-white/12 p-1" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 py-2 text-[14px] transition-colors ${
            value === o.value ? "bg-white/12 text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
