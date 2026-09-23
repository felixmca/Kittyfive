"use client";
/**
 * One scene in the chapter studio: its photo (tap to set where the pet's
 * face is), the lines that fade in over it, the Kling prompt with a copy
 * button and a 9:16 start-frame download for artta, and the drop for the clip
 * artta sends back (cut into frames in the browser, then uploaded).
 */
import { useId, useRef, useState, type PointerEvent } from "react";
import { mediaUrl } from "@/lib/supabase/config";
import { download, startFrame } from "@/lib/studio/frames";

export interface StudioScene {
  key: string;
  image: string | null;
  focus: { x: number; y: number } | null;
  kicker: string;
  beats: string;
  videoPrompt: string;
  frames: { dir: string } | null;
  pinLength: number;
}

export interface ClipProgress {
  phase: "cutting" | "uploading";
  done: number;
  total: number;
}

interface Props {
  scene: StudioScene;
  index: number;
  count: number;
  photos: string[];
  chapterSaved: boolean;
  clipsAllowed: boolean;
  progress: ClipProgress | null;
  onChange: (patch: Partial<StudioScene>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onClip: (file: File) => void;
}

// 16 px on phones: iOS Safari zooms the page into any text field smaller than that.
const FIELD =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[16px] sm:text-[15px] text-fg placeholder:text-white/30 outline-none transition-colors focus:border-accent/70 focus:bg-white/[0.07]";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted";
const SMALL_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[13px] text-fg/90 transition-colors hover:border-white/35 disabled:opacity-40";

export default function SceneCard({
  scene,
  index,
  count,
  photos,
  chapterSaved,
  clipsAllowed,
  progress,
  onChange,
  onMove,
  onRemove,
  onClip,
}: Props) {
  const id = useId();
  const clipInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = mediaUrl(scene.image);
  const focus = scene.focus ?? { x: 0.5, y: 0.42 };

  function setFocus(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    onChange({
      focus: {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      },
    });
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(scene.videoPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setNote("Copy did not work here; select the prompt and copy it by hand.");
    }
  }

  async function downloadStartFrame() {
    if (!url) return;
    setNote(null);
    try {
      download(await startFrame(url, scene.focus), `scene-${index + 1}-start-frame-9x16.jpg`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not make the start frame.");
    }
  }

  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4 sm:p-5" data-studio-scene={index}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">Scene {index + 1}</h3>
        <div className="flex items-center gap-1">
          <button type="button" className={SMALL_BTN} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move scene ${index + 1} up`}>↑</button>
          <button type="button" className={SMALL_BTN} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move scene ${index + 1} down`}>↓</button>
          <button type="button" className={SMALL_BTN} onClick={onRemove} aria-label={`Remove scene ${index + 1}`}>Remove</button>
        </div>
      </header>

      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div>
          <div
            className="relative aspect-[9/16] w-full max-w-[200px] cursor-crosshair overflow-hidden rounded-2xl bg-[#141416] ring-1 ring-white/10"
            onPointerDown={setFocus}
            role="img"
            aria-label={url ? "The scene's photo. Tap where the pet's face is." : "No photo chosen"}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: `${focus.x * 100}% ${focus.y * 100}%` }}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] text-muted">
                Choose a photo below
              </span>
            )}
            {url ? (
              <span
                aria-hidden
                className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent shadow-[0_0_0_2px_rgba(0,0,0,0.4)]"
                style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
              />
            ) : null}
            {scene.frames ? (
              <span className="absolute bottom-2 left-2 rounded-full bg-emerald-400/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#0b0b0c]">
                Clip
              </span>
            ) : null}
          </div>
          {url ? <p className="mt-2 text-[12px] text-muted">Tap the photo where her face is.</p> : null}
          {photos.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Photo for this scene">
              {photos.map((p, i) => {
                const u = mediaUrl(p);
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={p === scene.image}
                    aria-label={`Photo ${i + 1}`}
                    onClick={() => onChange({ image: p })}
                    className={`h-11 w-11 overflow-hidden rounded-lg ring-2 transition ${p === scene.image ? "ring-accent" : "ring-transparent opacity-70 hover:opacity-100"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {u ? <img src={u} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <label className={LABEL} htmlFor={`${id}-k`}>Small line above (optional)</label>
            <input id={`${id}-k`} className={FIELD} value={scene.kicker} maxLength={80} placeholder="April 2026" onChange={(e) => onChange({ kicker: e.target.value })} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${id}-b`}>The words, one line each</label>
            <textarea
              id={`${id}-b`}
              className={`${FIELD} min-h-[104px] resize-y leading-relaxed`}
              value={scene.beats}
              onChange={(e) => onChange({ beats: e.target.value })}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${id}-p`}>Kling 3.0 prompt for artta</label>
            <textarea
              id={`${id}-p`}
              className={`${FIELD} min-h-[120px] resize-y font-mono text-[16px] leading-relaxed sm:text-[13px]`}
              value={scene.videoPrompt}
              maxLength={2000}
              onChange={(e) => onChange({ videoPrompt: e.target.value })}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={SMALL_BTN} onClick={copyPrompt} disabled={!scene.videoPrompt} data-copy-prompt>
                {copied ? "Copied" : "Copy prompt"}
              </button>
              <button type="button" className={SMALL_BTN} onClick={downloadStartFrame} disabled={!url} data-start-frame>
                9:16 start frame ↓
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              On artta: Kling 3.0 · image + prompt · 9:16 · 5 s · sound off. Upload the start frame, paste the prompt, then drop
              the clip below.
            </p>
          </div>

          <div className="rounded-2xl border border-dashed border-white/15 p-3.5">
            {progress ? (
              <div>
                <p className="text-[13px] text-fg/90">
                  {progress.phase === "cutting" ? "Cutting the clip into frames" : "Uploading frames"} · {progress.done}/{progress.total}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              </div>
            ) : scene.frames ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-emerald-300">The clip is in. Scrolling plays it.</p>
                <div className="flex gap-2">
                  <button type="button" className={SMALL_BTN} onClick={() => clipInput.current?.click()} disabled={!clipsAllowed || !chapterSaved}>Replace</button>
                  <button type="button" className={SMALL_BTN} onClick={() => onChange({ frames: null })}>Remove</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-muted">
                  {!clipsAllowed
                    ? "Clips can be added on the live site."
                    : chapterSaved
                      ? "Got the clip from artta? Add it here."
                      : "Save the chapter first, then add its clips."}
                </p>
                <button
                  type="button"
                  className={SMALL_BTN}
                  onClick={() => clipInput.current?.click()}
                  disabled={!clipsAllowed || !chapterSaved}
                  data-add-clip
                >
                  Add the clip
                </button>
              </div>
            )}
            <input
              ref={clipInput}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onClip(f);
              }}
            />
          </div>
          {note ? <p className="text-[13px] text-red-200">{note}</p> : null}
        </div>
      </div>
    </article>
  );
}
