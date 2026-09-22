"use client";
/**
 * Add or edit a volume: its title, the one-line teaser, when it happened, a
 * one-word mood, and the story itself (paragraphs separated by a blank line).
 */
import { useEffect, useId, useRef, useState } from "react";

export interface VolumeDraft {
  title: string;
  subtitle: string;
  dateLabel: string;
  storyDate: string;
  mood: string;
  body: string;
}

interface Props {
  mode: "create" | "edit";
  initial: VolumeDraft;
  chapterCount: number;
  onSave: (draft: VolumeDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

const FIELD =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-fg placeholder:text-white/30 outline-none transition-colors focus:border-accent/70 focus:bg-white/[0.07]";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted";

export const EMPTY_VOLUME: VolumeDraft = { title: "", subtitle: "", dateLabel: "", storyDate: "", mood: "", body: "" };

export function bodyToText(body: string[]): string {
  return body.join("\n\n");
}

export function textToBody(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export default function VolumeEditor({ mode, initial, chapterCount, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof VolumeDraft>(k: K, v: VolumeDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prev;
    };
  }, [onClose]);

  async function save() {
    if (!draft.title.trim()) {
      setError("Give the volume a title.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
      setBusy(null);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setBusy("delete");
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not delete.");
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" data-lenis-prevent>
      <div aria-hidden className="absolute inset-0 bg-black/70" onClick={() => !busy && onClose()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        data-volume-editor
        className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/12 bg-[#111113] sm:max-h-[92dvh] sm:max-w-[620px] sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <h2 id={`${id}-h`} className="font-display text-[22px] font-light text-fg">
            {mode === "create" ? "New volume" : "Edit volume"}
          </h2>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-white/8 hover:text-fg" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain p-5">
          <div>
            <label className={LABEL} htmlFor={`${id}-t`}>Title</label>
            <input id={`${id}-t`} className={FIELD} value={draft.title} maxLength={120} placeholder="What the flyer said" onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${id}-s`}>Teaser</label>
            <input id={`${id}-s`} className={FIELD} value={draft.subtitle} maxLength={280} placeholder="One line that makes someone open it." onChange={(e) => set("subtitle", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={LABEL} htmlFor={`${id}-d`}>Date</label>
              <input id={`${id}-d`} type="date" className={`${FIELD} [color-scheme:dark]`} value={draft.storyDate} onChange={(e) => set("storyDate", e.target.value)} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-dl`}>Or in words</label>
              <input id={`${id}-dl`} className={FIELD} value={draft.dateLabel} maxLength={60} placeholder="January 2025" onChange={(e) => set("dateLabel", e.target.value)} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-m`}>Mood</label>
              <input id={`${id}-m`} className={FIELD} value={draft.mood} maxLength={40} placeholder="wet" onChange={(e) => set("mood", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor={`${id}-b`}>The story</label>
            <textarea
              id={`${id}-b`}
              className={`${FIELD} min-h-[180px] resize-y leading-relaxed`}
              value={draft.body}
              placeholder={"A few short paragraphs.\n\nLeave a blank line between them."}
              onChange={(e) => set("body", e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-5 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <div>
            {onDelete ? (
              confirmDelete ? (
                <span className="flex items-center gap-2 text-[14px]">
                  <span className="text-muted">
                    {chapterCount ? `Delete it and its ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}?` : "Delete for good?"}
                  </span>
                  <button type="button" onClick={remove} disabled={Boolean(busy)} className="rounded-full bg-red-500/85 px-4 py-2 text-white hover:bg-red-500">
                    {busy === "delete" ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-2 text-muted hover:text-fg">Keep</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="px-1 py-2 text-[14px] text-red-300/90 hover:text-red-200">
                  Delete volume
                </button>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-[15px] text-muted hover:text-fg">Cancel</button>
            <button type="button" onClick={save} disabled={Boolean(busy)} data-volume-save className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-[#141414] hover:opacity-90 disabled:opacity-60">
              {busy === "save" ? "Saving…" : mode === "create" ? "Add volume" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
