/**
 * Loads what the story needs, in the order it needs it.
 *
 *   /story/index.json          which chapters have frames (no request at all
 *                              for the others, so no 404s)
 *   <chapter>/manifest.json    frame count, size and clip length
 *   <chapter>/<last>.webp      every chapter's final frame, kept for the whole
 *                              visit: stops, stand-ins, the chat flight
 *   <chapter>/0001.webp …      the playing chapters' frames, in playback order
 *
 * Frame sets are resident only near the chapter being watched (the caller
 * decides); decoding goes through the shared limiter in frameLoader.
 */
import { fetchManifest, frameUrl, loadFrame, releaseFrame, type FrameImage } from "@/components/story/frameLoader";
import { SequenceController } from "@/components/story/useFrameSequence";
import type { LandingChapter } from "@/config/story";
import type { ClipInfo } from "./timeline";

const INDEX_URL = "/story/index.json";

export class StoryMedia {
  clips: (ClipInfo | null)[] = [];
  /** Bumps whenever a frame is decoded, so a redraw can tell something changed. */
  version = 0;
  private patterns: (string | undefined)[] = [];
  private seqs: (SequenceController | null)[] = [];
  private finals: (FrameImage | null)[] = [];
  private priorities: number[] = [];
  private listeners = new Set<() => void>();
  private abort = new AbortController();

  constructor(private chapters: LandingChapter[]) {}

  private dir(i: number): string {
    return `/story/${this.chapters[i].id}`;
  }

  /** Index, manifests and final frames. Resolves once the timeline can be built. */
  async init(): Promise<void> {
    const { signal } = this.abort;
    let listed: Record<string, unknown> | null = null;
    try {
      const res = await fetch(INDEX_URL, { cache: "no-cache", signal });
      if (res.ok) listed = (await res.json()) as Record<string, unknown>;
    } catch {
      listed = null;
    }
    if (signal.aborted) return;
    this.clips = await Promise.all(
      this.chapters.map(async (c, i) => {
        // No index at all (an old deploy): ask each chapter for its manifest.
        if (listed && !(c.id in listed)) return null;
        try {
          const m = await fetchManifest(this.dir(i), signal);
          if (!m) return null;
          this.patterns[i] = m.pattern;
          return { frames: m.frames, width: m.width, height: m.height, duration: m.duration ?? m.frames / 14.3 };
        } catch {
          return null;
        }
      }),
    );
    this.seqs = this.clips.map(() => null);
    this.finals = this.clips.map(() => null);
    this.priorities = this.clips.map((_, i) => i);
  }

  /** Fetch every chapter's final frame (small, kept). Chapter 1's first. */
  loadFinals(): Promise<void> {
    const { signal } = this.abort;
    return Promise.all(
      this.clips.map(async (clip, i) => {
        if (!clip) return;
        try {
          const img = await loadFrame(frameUrl(this.dir(i), this.patterns[i], clip.frames), signal);
          if (signal.aborted) {
            releaseFrame(img);
            return;
          }
          this.finals[i] = img;
          this.emit();
        } catch {
          /* the playing sequence will supply it */
        }
      }),
    ).then(() => undefined);
  }

  /** Keep chapter i's frames decoded (true) or let them go (false). */
  setResident(i: number, on: boolean, priority = i): void {
    const clip = this.clips[i];
    if (!clip) return;
    this.priorities[i] = priority;
    const seq = this.seqs[i];
    if (on && !seq) {
      const c = new SequenceController();
      c.priority = () => this.priorities[i];
      c.subscribe(() => this.emit());
      c.start({ dir: this.dir(i), hint: "present", order: "sequential" });
      this.seqs[i] = c;
    } else if (!on && seq) {
      seq.stop();
      this.seqs[i] = null;
    }
  }

  /** The frame to draw for chapter i at `index` (nearest decoded), or null. */
  frame = (i: number, index: number): FrameImage | null => {
    const clip = this.clips[i];
    if (!clip) return null;
    const k = Math.max(0, Math.min(clip.frames - 1, index));
    const exact = this.seqs[i]?.frames[k] ?? null;
    if (exact) return exact;
    if (k === clip.frames - 1 && this.finals[i]) return this.finals[i];
    return this.seqs[i]?.getFrame(k) ?? this.finals[i] ?? null;
  };

  /** Is frame `index` of chapter i decoded (not just a stand-in neighbour)? */
  has(i: number, index: number): boolean {
    const clip = this.clips[i];
    if (!clip) return true;
    const k = Math.max(0, Math.min(clip.frames - 1, Math.round(index)));
    if (k === clip.frames - 1 && this.finals[i]) return true;
    return Boolean(this.seqs[i]?.frames[k]);
  }

  hasFinal(i: number): boolean {
    return Boolean(this.finals[i]) || !this.clips[i];
  }

  /** How many frames of chapter i are decoded from the start without a gap. */
  prefix(i: number): number {
    const frames = this.seqs[i]?.frames;
    if (!frames) return 0;
    let n = 0;
    while (n < frames.length && frames[n]) n++;
    return n;
  }

  loaded(i: number): number {
    return this.seqs[i]?.snap.loaded ?? 0;
  }

  /** Something new was decoded. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  destroy(): void {
    this.abort.abort();
    this.seqs.forEach((s) => s?.stop());
    this.finals.forEach((f) => releaseFrame(f));
    this.seqs = [];
    this.finals = [];
    this.listeners.clear();
  }
}
