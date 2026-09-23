/**
 * The book: a pet has volumes, a volume has chapters, a chapter has scenes.
 * Shapes mirror supabase/migrations/*_platform_core.sql (camelCased); the
 * demo data in src/config/stories.ts uses the same shapes.
 */

export type ChapterStatus = "draft" | "published";

export type SceneTransition = "crossfade" | "zoom" | "slide-up" | "walk-out-of-frame" | "fall";

export interface Pet {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
}

/** Image B takes over from image A along `angle` (CSS degrees), between from% and to%. */
export interface TileBlend {
  angle: number;
  from: number;
  to: number;
}

export interface Volume {
  id: string;
  slug: string;
  position: number;
  title: string;
  subtitle: string | null;
  mood: string | null;
  dateLabel: string | null;
  storyDate: string | null;
  body: string[];
}

export interface ChapterSummary {
  id: string;
  volumeId: string;
  slug: string;
  position: number;
  status: ChapterStatus;
  title: string;
  subtitle: string | null;
  description: string | null;
  dateLabel: string | null;
  storyDate: string | null;
  tileImageA: string | null;
  tileImageB: string | null;
  tileBlend: TileBlend;
  landingOrder: number | null;
}

export interface SceneFrames {
  /** Folder (site path, URL or bucket path) holding manifest.json and the frames. */
  dir: string;
}

export interface Scene {
  id: string;
  position: number;
  kicker: string | null;
  title: string | null;
  beats: string[];
  image: string | null;
  focus: { x: number; y: number } | null;
  frames: SceneFrames | null;
  videoPrompt: string | null;
  pinLength: number;
  transition: SceneTransition;
}

export interface Chapter extends ChapterSummary {
  scenes: Scene[];
}

export interface VolumeWithChapters extends Volume {
  chapters: ChapterSummary[];
}

export interface PetStories {
  pet: Pet;
  volumes: VolumeWithChapters[];
  source: "supabase" | "demo";
}

/** One stop on the continuous read: chapters of every volume, in order. */
export interface ReadingEntry {
  chapterId: string;
  slug: string;
  title: string;
  volumeId: string;
  volumeSlug: string;
  volumeTitle: string;
  /** 1-based. */
  volumeNumber: number;
  /** 1-based within its volume. */
  chapterNumber: number;
  firstInVolume: boolean;
}

export const DEFAULT_BLEND: TileBlend = { angle: 180, from: 35, to: 70 };

// ── formatting ───────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-04-19" → "19 April 2026". Deterministic on server and client. */
export function formatIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The label wins; otherwise the formatted date; otherwise nothing. */
export function storyDateText(item: { dateLabel: string | null; storyDate: string | null }): string | null {
  return item.dateLabel?.trim() || formatIsoDate(item.storyDate);
}

export function readingOrder(volumes: VolumeWithChapters[]): ReadingEntry[] {
  const out: ReadingEntry[] = [];
  volumes.forEach((volume, vi) => {
    volume.chapters.forEach((chapter, ci) => {
      out.push({
        chapterId: chapter.id,
        slug: chapter.slug,
        title: chapter.title,
        volumeId: volume.id,
        volumeSlug: volume.slug,
        volumeTitle: volume.title,
        volumeNumber: vi + 1,
        chapterNumber: ci + 1,
        firstInVolume: ci === 0,
      });
    });
  });
  return out;
}

export function slugify(input: string, fallback = "chapter"): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return s || fallback;
}

/** Slugs that would collide with routes under /stories. */
const RESERVED_SLUGS = ["new", "edit"];

/** slugify, then add -2, -3… until it is not in `taken` (or reserved). */
export function uniqueSlug(input: string, taken: Iterable<string>, fallback?: string): string {
  const used = new Set([...taken, ...RESERVED_SLUGS]);
  const base = slugify(input, fallback);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 70)}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 60)}-${Date.now().toString(36)}`;
}

// ── database rows → shapes ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function blendFrom(v: unknown): TileBlend {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const clampPct = (x: unknown, d: number) => Math.min(100, Math.max(0, num(x, d)));
  const from = clampPct(o.from, DEFAULT_BLEND.from);
  const to = clampPct(o.to, DEFAULT_BLEND.to);
  return {
    angle: ((num(o.angle, DEFAULT_BLEND.angle) % 360) + 360) % 360,
    from: Math.min(from, to),
    to: Math.max(from, to),
  };
}

export function petFromRow(r: Row): Pet {
  return { id: String(r.id), slug: String(r.slug), name: String(r.name), tagline: str(r.tagline) };
}

export function volumeFromRow(r: Row): Volume {
  return {
    id: String(r.id),
    slug: String(r.slug),
    position: num(r.position),
    title: String(r.title ?? ""),
    subtitle: str(r.subtitle),
    mood: str(r.mood),
    dateLabel: str(r.date_label),
    storyDate: str(r.story_date),
    body: Array.isArray(r.body) ? (r.body as unknown[]).map(String) : [],
  };
}

export function chapterFromRow(r: Row): ChapterSummary {
  return {
    id: String(r.id),
    volumeId: String(r.volume_id),
    slug: String(r.slug),
    position: num(r.position),
    status: r.status === "published" ? "published" : "draft",
    title: String(r.title ?? ""),
    subtitle: str(r.subtitle),
    description: str(r.description),
    dateLabel: str(r.date_label),
    storyDate: str(r.story_date),
    tileImageA: str(r.tile_image_a),
    tileImageB: str(r.tile_image_b),
    tileBlend: blendFrom(r.tile_blend),
    landingOrder: typeof r.landing_order === "number" ? r.landing_order : null,
  };
}

const TRANSITIONS: SceneTransition[] = ["crossfade", "zoom", "slide-up", "walk-out-of-frame", "fall"];

export function sceneFromRow(r: Row): Scene {
  const focus = r.focus && typeof r.focus === "object" ? (r.focus as Record<string, unknown>) : null;
  const frames = r.frames && typeof r.frames === "object" ? (r.frames as Record<string, unknown>) : null;
  const transition = TRANSITIONS.includes(r.transition as SceneTransition)
    ? (r.transition as SceneTransition)
    : "crossfade";
  return {
    id: String(r.id),
    position: num(r.position),
    kicker: str(r.kicker),
    title: str(r.title),
    beats: Array.isArray(r.beats) ? (r.beats as unknown[]).map(String).filter(Boolean) : [],
    image: str(r.image),
    focus: focus ? { x: Math.min(1, Math.max(0, num(focus.x, 0.5))), y: Math.min(1, Math.max(0, num(focus.y, 0.4))) } : null,
    frames: frames && typeof frames.dir === "string" && frames.dir ? { dir: frames.dir } : null,
    videoPrompt: str(r.video_prompt),
    pinLength: Math.min(6, Math.max(1, num(r.pin_length, 2.2))),
    transition,
  };
}

export const VOLUME_COLUMNS = "id, slug, position, title, subtitle, mood, date_label, story_date, body";
export const CHAPTER_COLUMNS =
  "id, volume_id, slug, position, status, title, subtitle, description, date_label, story_date, tile_image_a, tile_image_b, tile_blend, landing_order";
export const SCENE_COLUMNS =
  "id, chapter_id, position, kicker, title, beats, image, focus, frames, video_prompt, pin_length, transition";

/** Group chapters under their volumes, both sorted by position. */
export function assemble(volumes: Volume[], chapters: ChapterSummary[]): VolumeWithChapters[] {
  const byVolume = new Map<string, ChapterSummary[]>();
  for (const c of chapters) {
    const list = byVolume.get(c.volumeId) ?? [];
    list.push(c);
    byVolume.set(c.volumeId, list);
  }
  return [...volumes]
    .sort((a, b) => a.position - b.position)
    .map((v) => ({
      ...v,
      chapters: (byVolume.get(v.id) ?? []).sort((a, b) => a.position - b.position),
    }));
}
