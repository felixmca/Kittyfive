/**
 * Loads what the story needs, in the order it needs it, and keeps only a
 * small window of it decoded.
 *
 *   /story/index.json          which chapters have frames (no request at all
 *                              for the others, so no 404s)
 *   <chapter>/manifest.json    frame count, size and clip length
 *   <chapter>/<last>.webp      every chapter's final frame, decoded and kept
 *                              for the whole visit: stops, stand-ins, the flight
 *   <chapter>/0001.webp …      every frame as compressed bytes (about 45 KB
 *                              each, kept once fetched), decoded only inside a
 *                              window around the playhead
 *
 * Why a window: a decoded 576×1024 frame is 2.4 MB, so one clip is 170 MB and
 * two are more than iOS Safari lets a page hold (the story went blank on an
 * iPhone with two chapters decoded, 23 Sep 2026). The window keeps about 30
 * frames decoded on phones and 70 on computers, decoding ahead of the
 * playhead in the direction it is moving, plus the first frames of the
 * chapter it will play next. A frame that will not load or decode after a few
 * tries is marked broken and its neighbour stands in, so playback never waits
 * on it forever.
 */
import {
  decodeFrameBlob,
  fetchFrameBlob,
  fetchManifest,
  frameUrl,
  loadFrame,
  releaseFrame,
  schedule,
  type FrameImage,
} from "@/components/story/frameLoader";
import type { LandingChapter } from "@/config/story";
import type { ClipInfo } from "./timeline";

const INDEX_URL = "/story/index.json";
/** Give up on the index or a manifest after this long (the story then plays stand-ins). */
const META_TIMEOUT_MS = 9000;
const FETCH_TRIES = 3;
/** Chapter 1's final frame waits at most this long for its first frames; the other chapters' finals wait for all of them. */
const FINAL1_WAIT_MS = 6000;
const FINALS_WAIT_MS = 8000;
const DECODE_TRIES = 2;

/** Where the playhead is and where it is going; the window follows it. */
export interface Focus {
  /** Chapter whose frames are on screen (-1: a stand-in or nothing). */
  chapter: number;
  /** Fractional frame position in that chapter. */
  pos: number;
  /** +1 playing on, -1 playing back. */
  dir: number;
  /** The chapter with a clip that plays next in that direction (-1: none). */
  next: number;
}

interface Budget {
  /** Frames decoded ahead of the playhead, and behind it. */
  ahead: number;
  behind: number;
  /** First frames of the next chapter kept ready, so a swipe starts at once. */
  head: number;
  /** Decodes at the same time. */
  decoders: number;
}

const PHONE: Budget = { ahead: 18, behind: 6, head: 8, decoders: 2 };
const COMPUTER: Budget = { ahead: 36, behind: 16, head: 16, decoders: 3 };

function smallDevice(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  return ios || coarse || (typeof memory === "number" && memory <= 4);
}

interface ChapterFrames {
  dir: string;
  pattern?: string;
  /** The clip's build (manifest builtAt), in every frame URL so a re-cut clip is fetched fresh. */
  version?: string;
  clip: ClipInfo;
  /** Compressed bytes, once fetched. */
  blobs: (Blob | null)[];
  /** Frames with neither bytes nor a broken mark yet (0: nothing left to fetch). */
  missing: number;
  fetching: Set<number>;
  fetchTries: Uint8Array;
  decoded: Map<number, FrameImage>;
  decoding: Set<number>;
  decodeTries: Uint8Array;
  /** Could not be fetched or decoded: a neighbour stands in. */
  broken: Set<number>;
  final: FrameImage | null;
}

interface Want {
  ch: number;
  idx: number;
  pr: number;
}

export class StoryMedia {
  clips: (ClipInfo | null)[] = [];
  /** Bumps whenever a frame is decoded, so a redraw can tell something changed. */
  version = 0;
  private chapters: (ChapterFrames | null)[] = [];
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private readonly budget: Budget = smallDevice() ? PHONE : COMPUTER;
  private focusKey = "";
  private focusNow: Focus = { chapter: -1, pos: 0, dir: 1, next: -1 };
  /** Frames the window wants decoded, most urgent first. */
  private wants: Want[] = [];
  private wanted: Set<number>[] = [];
  private decodingCount = 0;
  /** Most frames decoded at once this visit (the story report sends it home). */
  private peak = 0;
  private suspended = false;
  private destroyed = false;

  constructor(private readonly config: LandingChapter[]) {}

  private dir(i: number): string {
    return `/story/${this.config[i].id}`;
  }

  /** Index and manifests. Resolves once the timeline can be built (stand-ins for anything missing). */
  async init(): Promise<void> {
    const { signal } = this.abort;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), META_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    let listed: Record<string, unknown> | null = null;
    try {
      const res = await fetch(INDEX_URL, { cache: "no-cache", signal: timeout.signal });
      if (res.ok) listed = (await res.json()) as Record<string, unknown>;
    } catch {
      listed = null;
    }
    const patterns: (string | undefined)[] = [];
    const versions: (string | undefined)[] = [];
    this.clips = await Promise.all(
      this.config.map(async (c, i) => {
        // No index at all (an old deploy): ask each chapter for its manifest.
        if (listed && !(c.id in listed)) return null;
        if (timeout.signal.aborted) return null;
        try {
          const m = await fetchManifest(this.dir(i), timeout.signal);
          if (!m) return null;
          patterns[i] = m.pattern;
          versions[i] = m.version;
          return { frames: m.frames, width: m.width, height: m.height, duration: m.duration ?? m.frames / 14.3 };
        } catch {
          return null;
        }
      }),
    );
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    this.chapters = this.clips.map((clip, i) =>
      clip
        ? {
            dir: this.dir(i),
            pattern: patterns[i],
            version: versions[i],
            clip,
            blobs: new Array<Blob | null>(clip.frames).fill(null),
            missing: clip.frames,
            fetching: new Set(),
            fetchTries: new Uint8Array(clip.frames),
            decoded: new Map(),
            decoding: new Set(),
            decodeTries: new Uint8Array(clip.frames),
            broken: new Set(),
            final: null,
          }
        : null,
    );
    this.wanted = this.clips.map(() => new Set<number>());
  }

  /**
   * Fetch every chapter's final frame (decoded and kept), without taking
   * bandwidth from the frames about to play: chapter 1's final once its
   * first dozen frames are in (FINAL1_WAIT_MS at most), the other chapters'
   * once chapter 1's frames are all in (FINALS_WAIT_MS at most). On a slow
   * connection the story's first picture is then its first frame, not the
   * end of chapter 1. `stillsOnly` (reduced motion: no clip frames are
   * fetched, the finals are the pictures) loads them all at once.
   */
  async loadFinals(stillsOnly = false): Promise<void> {
    const { signal } = this.abort;
    const one = async (ch: ChapterFrames | null) => {
      if (!ch) return;
      const last = ch.clip.frames;
      for (let attempt = 0; attempt < FETCH_TRIES && !ch.final; attempt++) {
        try {
          const img = await loadFrame(frameUrl(ch.dir, ch.pattern, last, ch.version), signal);
          if (signal.aborted || this.destroyed) {
            releaseFrame(img);
            return;
          }
          ch.final = img;
          this.emit();
        } catch {
          if (signal.aborted) return;
          await wait(400 * (attempt + 1));
        }
      }
    };
    const [first, ...rest] = this.chapters;
    const n = first?.clip.frames ?? 0;
    if (stillsOnly) {
      await Promise.all(this.chapters.map(one));
      return;
    }
    await this.until(() => !first || this.fetchedPrefix(0) >= Math.min(n, 12), FINAL1_WAIT_MS);
    if (this.destroyed) return;
    await one(first ?? null);
    await this.until(() => !first || this.fetchedPrefix(0) >= n, FINALS_WAIT_MS);
    if (this.destroyed) return;
    await Promise.all(rest.map(one));
  }

  /** Resolves once `ready()` holds (checked whenever something lands) or after `ms`. */
  private until(ready: () => boolean, ms: number): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };
      const check = () => {
        if (ready()) done();
      };
      const timer = setTimeout(done, ms);
      this.listeners.add(check);
    });
  }

  // ─── the window ───────────────────────────────────────────────────────────

  /** Move the window. Cheap when nothing changed, so it can be called every frame. */
  focus(f: Focus): void {
    const pos = Math.max(0, Math.round(f.pos));
    const dir = f.dir < 0 ? -1 : 1;
    const key = `${f.chapter}|${pos}|${dir}|${f.next}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.focusNow = { chapter: f.chapter, pos, dir, next: f.next };
    this.plan();
  }

  /** Which frames to decode (and so which to let go), then fetch and decode what is missing. */
  private plan(): void {
    const { chapter, pos, dir, next } = this.focusNow;
    const b = this.budget;
    const wants: Want[] = [];
    const wanted = this.chapters.map(() => new Set<number>());
    const push = (ch: number, idx: number, pr: number) => {
      const c = this.chapters[ch];
      if (!c || idx < 0 || idx >= c.clip.frames || wanted[ch].has(idx)) return;
      wanted[ch].add(idx);
      wants.push({ ch, idx, pr });
    };
    if (chapter >= 0) {
      for (let d = 0; d <= b.ahead; d++) push(chapter, pos + d * dir, d);
      for (let d = 1; d <= b.behind; d++) push(chapter, pos - d * dir, 3 + d * 2);
    }
    if (next >= 0 && next !== chapter) {
      for (let d = 0; d < b.head; d++) push(next, dir > 0 ? d : this.chapters[next]!.clip.frames - 1 - d, 40 + d);
    }
    wants.sort((a, z) => a.pr - z.pr);
    this.wants = wants;
    this.wanted = wanted;

    // Let go of what the window no longer covers (in-flight decodes are dropped when they land).
    this.chapters.forEach((c, i) => {
      if (!c) return;
      for (const [idx, img] of c.decoded) {
        if (!wanted[i].has(idx)) {
          c.decoded.delete(idx);
          releaseFrame(img);
        }
      }
    });
    this.fetchMissing();
    this.pump();
  }

  /** The playing chapter and the next are fetched whole (the bytes are small); the window's frames first. */
  private fetchMissing(): void {
    if (this.destroyed) return;
    const { chapter, next } = this.focusNow;
    const order: number[] = [];
    for (const ch of [chapter, next]) if (ch >= 0 && !order.includes(ch)) order.push(ch);
    for (const ch of order) {
      const c = this.chapters[ch];
      if (!c || !c.missing) continue;
      for (let idx = 0; idx < c.clip.frames; idx++) this.fetchOne(ch, idx);
    }
  }

  /** Lower goes first: the playing chapter in playing order, then the next chapter from its start. */
  private fetchPriority(ch: number, idx: number): number {
    const { chapter, pos, dir, next } = this.focusNow;
    const c = this.chapters[ch];
    const n = c?.clip.frames ?? 0;
    // A frame that has already failed goes behind the fresh ones, or a few
    // dead requests near the playhead would take every download slot again
    // and again (a weak signal) while the rest of the clip waits.
    const retry = c ? c.fetchTries[idx] * 10 * n : 0;
    if (ch === chapter) {
      const d = (idx - pos) * dir;
      return retry + (d >= 0 ? d : n + -d);
    }
    if (ch === next) return retry + 3 * n + (dir > 0 ? idx : n - 1 - idx);
    return retry + 6 * n + idx;
  }

  private fetchOne(ch: number, idx: number): void {
    const c = this.chapters[ch];
    if (!c || c.blobs[idx] || c.fetching.has(idx) || c.broken.has(idx)) return;
    c.fetching.add(idx);
    const { signal } = this.abort;
    schedule(
      (sig) => fetchFrameBlob(frameUrl(c.dir, c.pattern, idx + 1, c.version), sig),
      () => this.fetchPriority(ch, idx),
      signal,
    ).then(
      (blob) => {
        c.fetching.delete(idx);
        if (this.destroyed) return;
        c.blobs[idx] = blob;
        c.missing--;
        this.emit();
        this.pump();
      },
      () => {
        c.fetching.delete(idx);
        if (signal.aborted || this.destroyed) return;
        c.fetchTries[idx]++;
        if (c.fetchTries[idx] >= FETCH_TRIES) {
          c.broken.add(idx);
          c.missing--;
          this.emit();
          return;
        }
        setTimeout(() => this.fetchOne(ch, idx), 500 * c.fetchTries[idx]);
      },
    );
  }

  /** Decode the most urgent wanted frames that have bytes, a few at a time. */
  private pump(): void {
    if (this.suspended || this.destroyed) return;
    for (const w of this.wants) {
      if (this.decodingCount >= this.budget.decoders) return;
      const c = this.chapters[w.ch];
      if (!c) continue;
      const blob = c.blobs[w.idx];
      if (!blob || c.decoded.has(w.idx) || c.decoding.has(w.idx) || c.broken.has(w.idx)) continue;
      this.decode(w.ch, w.idx, blob);
    }
  }

  private decode(ch: number, idx: number, blob: Blob): void {
    const c = this.chapters[ch]!;
    c.decoding.add(idx);
    this.decodingCount++;
    decodeFrameBlob(blob).then(
      (img) => {
        c.decoding.delete(idx);
        this.decodingCount--;
        if (this.destroyed || this.suspended || !this.wanted[ch]?.has(idx) || c.decoded.has(idx)) {
          releaseFrame(img);
        } else {
          c.decoded.set(idx, img);
          this.peak = Math.max(this.peak, this.decodedCount());
          this.emit();
        }
        this.pump();
      },
      () => {
        c.decoding.delete(idx);
        this.decodingCount--;
        if (this.destroyed) return;
        c.decodeTries[idx]++;
        if (c.decodeTries[idx] >= DECODE_TRIES) {
          c.broken.add(idx);
          this.emit();
        }
        this.pump();
      },
    );
  }

  /**
   * The page went into the background: give the decoded window back (bytes
   * and final frames stay). The frame on screen stays too, so coming back
   * shows where the story was rather than the nearest thing left (the end of
   * the chapter) while the window decodes again.
   */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    const { chapter, pos } = this.focusNow;
    this.chapters.forEach((c, i) => {
      if (!c) return;
      for (const [idx, img] of c.decoded) {
        if (i === chapter && idx === pos) continue;
        c.decoded.delete(idx);
        releaseFrame(img);
      }
    });
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.fetchMissing();
    this.pump();
    this.emit();
  }

  // ─── lookups ──────────────────────────────────────────────────────────────

  /** The frame to draw for chapter i at `index` (nearest decoded), or null. */
  frame = (i: number, index: number): FrameImage | null => {
    const c = this.chapters[i];
    if (!c) return null;
    const n = c.clip.frames;
    const k = Math.max(0, Math.min(n - 1, index));
    const exact = c.decoded.get(k);
    if (exact) return exact;
    if (k === n - 1 && c.final) return c.final;
    for (let d = 1; d < n; d++) {
      const lo = c.decoded.get(k - d);
      if (lo) return lo;
      const hi = c.decoded.get(k + d);
      if (hi) return hi;
    }
    return c.final;
  };

  /** Can frame `index` of chapter i be shown as itself (or is it broken, so a neighbour must do)? */
  has(i: number, index: number): boolean {
    const c = this.chapters[i];
    if (!c) return true;
    const k = Math.max(0, Math.min(c.clip.frames - 1, Math.round(index)));
    if (k === c.clip.frames - 1 && c.final) return true;
    return c.decoded.has(k) || c.broken.has(k);
  }

  hasFinal(i: number): boolean {
    const c = this.chapters[i];
    return !c || Boolean(c.final);
  }

  /** Frames of chapter i whose bytes are here, counted from the start without a gap (broken ones count). */
  fetchedPrefix(i: number): number {
    const c = this.chapters[i];
    if (!c) return 0;
    let n = 0;
    while (n < c.clip.frames && (c.blobs[n] || c.broken.has(n))) n++;
    return n;
  }

  /** Frames of chapter i decoded from the start without a gap. */
  decodedPrefix(i: number): number {
    const c = this.chapters[i];
    if (!c) return 0;
    let n = 0;
    while (n < c.clip.frames && (c.decoded.has(n) || c.broken.has(n))) n++;
    return n;
  }

  private decodedCount(): number {
    let n = 0;
    for (const c of this.chapters) n += c ? c.decoded.size : 0;
    return n;
  }

  /** For the verify harness and the story report: how much is decoded now, and at most. */
  stats(): { decoded: number; peak: number; finals: number; fetched: number; broken: number; budget: Budget } {
    let finals = 0;
    let fetched = 0;
    let broken = 0;
    for (const c of this.chapters) {
      if (!c) continue;
      finals += c.final ? 1 : 0;
      fetched += c.blobs.filter(Boolean).length;
      broken += c.broken.size;
    }
    return { decoded: this.decodedCount(), peak: this.peak, finals, fetched, broken, budget: this.budget };
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
    this.destroyed = true;
    this.abort.abort();
    for (const c of this.chapters) {
      if (!c) continue;
      c.decoded.forEach((img) => releaseFrame(img));
      c.decoded.clear();
      releaseFrame(c.final);
      c.final = null;
    }
    this.chapters = [];
    this.listeners.clear();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
