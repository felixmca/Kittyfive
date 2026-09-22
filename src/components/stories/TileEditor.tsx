"use client";
/**
 * The chapter tile editor: date, title, subtitle, description, and up to two
 * background photos blended by a gradient, with a live preview on top. Also
 * where a chapter is published, moved to another volume, or deleted.
 *
 * A full-height sheet on phones, a centred panel on wider screens. Photos
 * upload the moment they are chosen (resized in the browser first), so Save
 * only writes the chapter row.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import TileFace, { type TileFaceData } from "./TileFace";
import { mediaUrl } from "@/lib/supabase/config";
import { DEFAULT_BLEND, type ChapterStatus, type TileBlend } from "@/lib/stories/types";

export interface TileDraft {
  title: string;
  subtitle: string;
  description: string;
  dateLabel: string;
  storyDate: string;
  tileImageA: string | null;
  tileImageB: string | null;
  tileBlend: TileBlend;
  status: ChapterStatus;
  volumeId: string;
}

interface Props {
  mode: "create" | "edit";
  initial: TileDraft;
  slug: string;
  volumes: { id: string; title: string }[];
  onUpload: (file: File) => Promise<string>;
  onSave: (draft: TileDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  /** Link to the chapter's own editor (scenes, clips), when it exists. */
  extra?: ReactNode;
}

const DIRECTIONS: { angle: number; label: string; glyph: string }[] = [
  { angle: 180, label: "Top to bottom", glyph: "↓" },
  { angle: 0, label: "Bottom to top", glyph: "↑" },
  { angle: 90, label: "Left to right", glyph: "→" },
  { angle: 270, label: "Right to left", glyph: "←" },
  { angle: 135, label: "Diagonal, top left to bottom right", glyph: "↘" },
  { angle: 225, label: "Diagonal, top right to bottom left", glyph: "↙" },
];

const FIELD =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-fg placeholder:text-white/30 outline-none transition-colors focus:border-accent/70 focus:bg-white/[0.07]";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted";

export function emptyDraft(volumeId: string): TileDraft {
  return {
    title: "",
    subtitle: "",
    description: "",
    dateLabel: "",
    storyDate: "",
    tileImageA: null,
    tileImageB: null,
    tileBlend: { ...DEFAULT_BLEND },
    status: "draft",
    volumeId,
  };
}

export default function TileEditor({ mode, initial, slug, volumes, onUpload, onSave, onDelete, onClose, extra }: Props) {
  const [draft, setDraft] = useState<TileDraft>(initial);
  const [busy, setBusy] = useState<null | "save" | "delete" | "a" | "b">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const set = <K extends keyof TileDraft>(key: K, value: TileDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Escape closes; focus moves into the panel; the page behind does not scroll.
  useEffect(() => {
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(which: "a" | "b", file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(which);
    try {
      const ref = await onUpload(file);
      set(which === "a" ? "tileImageA" : "tileImageB", ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo did not upload.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!draft.title.trim()) {
      setError("Give the chapter a title.");
      return;
    }
    setError(null);
    setBusy("save");
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

  const preview: TileFaceData = {
    slug,
    title: draft.title,
    subtitle: draft.subtitle || null,
    description: draft.description || null,
    dateLabel: draft.dateLabel || null,
    storyDate: draft.storyDate || null,
    tileImageA: draft.tileImageA,
    tileImageB: draft.tileImageB,
    tileBlend: draft.tileBlend,
    status: draft.status,
  };
  const blend = draft.tileBlend;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" data-lenis-prevent>
      <div aria-hidden className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-tile-editor
        className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/12 bg-[#111113] shadow-2xl sm:max-h-[92dvh] sm:max-w-[880px] sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
          <h2 id={titleId} className="font-display text-[22px] font-light text-fg">
            {mode === "create" ? "New chapter" : "Edit chapter tile"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-fg"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="grid flex-1 gap-6 overflow-y-auto overscroll-contain p-5 sm:grid-cols-[300px_1fr] sm:p-6">
          <div className="sm:sticky sm:top-0 sm:self-start">
            <p className={LABEL}>Preview</p>
            <div className="mx-auto aspect-[3/4] w-[210px] overflow-hidden rounded-[22px] ring-1 ring-white/12 sm:w-full" data-tile-preview>
              <TileFace data={preview} eager />
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <label className={LABEL} htmlFor={`${titleId}-title`}>Title</label>
              <input
                id={`${titleId}-title`}
                className={FIELD}
                value={draft.title}
                maxLength={120}
                placeholder="And there she was"
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${titleId}-subtitle`}>Subtitle</label>
              <input
                id={`${titleId}-subtitle`}
                className={FIELD}
                value={draft.subtitle}
                maxLength={160}
                placeholder="A subtle type of love."
                onChange={(e) => set("subtitle", e.target.value)}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${titleId}-description`}>Description</label>
              <textarea
                id={`${titleId}-description`}
                className={`${FIELD} min-h-[84px] resize-y`}
                value={draft.description}
                maxLength={600}
                placeholder="One or two sentences for the tile."
                onChange={(e) => set("description", e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor={`${titleId}-date`}>Date</label>
                <input
                  id={`${titleId}-date`}
                  type="date"
                  className={`${FIELD} [color-scheme:dark]`}
                  value={draft.storyDate}
                  onChange={(e) => set("storyDate", e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor={`${titleId}-datelabel`}>Or in words</label>
                <input
                  id={`${titleId}-datelabel`}
                  className={FIELD}
                  value={draft.dateLabel}
                  maxLength={60}
                  placeholder="Spring 2026"
                  onChange={(e) => set("dateLabel", e.target.value)}
                />
              </div>
            </div>

            <fieldset>
              <legend className={LABEL}>Background photos</legend>
              <div className="grid grid-cols-2 gap-3">
                <PhotoSlot
                  label="First"
                  hint="Top of the blend"
                  value={draft.tileImageA}
                  busy={busy === "a"}
                  onPick={(f) => upload("a", f)}
                  onClear={() => set("tileImageA", null)}
                />
                <PhotoSlot
                  label="Second"
                  hint="Blends in over it"
                  value={draft.tileImageB}
                  busy={busy === "b"}
                  onPick={(f) => upload("b", f)}
                  onClear={() => set("tileImageB", null)}
                />
              </div>
            </fieldset>

            <fieldset disabled={!draft.tileImageA || !draft.tileImageB} className="disabled:opacity-45">
              <legend className={LABEL}>Blend</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Blend direction">
                {DIRECTIONS.map((d) => (
                  <button
                    key={d.angle}
                    type="button"
                    role="radio"
                    aria-checked={blend.angle === d.angle}
                    aria-label={d.label}
                    title={d.label}
                    onClick={() => set("tileBlend", { ...blend, angle: d.angle })}
                    className={`flex h-10 w-10 items-center justify-center rounded-full border text-[17px] transition-colors ${
                      blend.angle === d.angle
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-white/12 text-muted hover:border-white/30 hover:text-fg"
                    }`}
                  >
                    {d.glyph}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Range
                  label="Blend starts"
                  value={blend.from}
                  onChange={(v) => set("tileBlend", { ...blend, from: Math.min(v, blend.to - 5) })}
                />
                <Range
                  label="Blend ends"
                  value={blend.to}
                  onChange={(v) => set("tileBlend", { ...blend, to: Math.max(v, blend.from + 5) })}
                />
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor={`${titleId}-volume`}>Volume</label>
                <select
                  id={`${titleId}-volume`}
                  className={`${FIELD} [color-scheme:dark]`}
                  value={draft.volumeId}
                  onChange={(e) => set("volumeId", e.target.value)}
                >
                  {volumes.map((v, i) => (
                    <option key={v.id} value={v.id}>
                      {`Volume ${i + 1} · ${v.title}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={LABEL}>Who can see it</span>
                <div className="flex rounded-xl border border-white/12 p-1" role="radiogroup" aria-label="Status">
                  {(["draft", "published"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={draft.status === s}
                      onClick={() => set("status", s)}
                      className={`flex-1 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                        draft.status === s ? "bg-white/12 text-fg" : "text-muted hover:text-fg"
                      }`}
                    >
                      {s === "draft" ? "Only me (draft)" : "Everyone"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {extra}

            {error ? (
              <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-5 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <div>
            {onDelete ? (
              confirmDelete ? (
                <span className="flex items-center gap-2 text-[14px]">
                  <span className="text-muted">Delete for good?</span>
                  <button type="button" onClick={remove} disabled={Boolean(busy)} className="rounded-full bg-red-500/85 px-4 py-2 text-white hover:bg-red-500">
                    {busy === "delete" ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-2 text-muted hover:text-fg">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)} className="px-1 py-2 text-[14px] text-red-300/90 hover:text-red-200">
                  Delete chapter
                </button>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={Boolean(busy)} className="rounded-full px-4 py-2.5 text-[15px] text-muted hover:text-fg">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={Boolean(busy)}
              data-tile-save
              className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy === "save" ? "Saving…" : mode === "create" ? "Add chapter" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function PhotoSlot({
  label,
  hint,
  value,
  busy,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: string | null;
  busy: boolean;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = mediaUrl(value);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="group relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/20 bg-white/[0.03] text-center transition-colors hover:border-white/40"
        aria-label={`${value ? "Replace" : "Choose"} the ${label.toLowerCase()} background photo`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        ) : null}
        <span className={`relative flex flex-col items-center gap-1 px-2 ${url ? "rounded-xl bg-black/55 px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`}>
          <span className="text-[14px] text-fg">{busy ? "Uploading…" : url ? "Replace" : `${label} photo`}</span>
          {!url && !busy ? <span className="text-[12px] text-muted">{hint}</span> : null}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {value ? (
        <button type="button" onClick={onClear} className="self-start text-[13px] text-muted hover:text-fg">
          Remove
        </button>
      ) : null}
    </div>
  );
}

function Range({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="text-[13px] text-muted">{label}</label>
        <span className="text-[13px] tabular-nums text-fg/80">{value}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}
