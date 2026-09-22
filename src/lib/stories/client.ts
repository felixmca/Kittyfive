"use client";
/**
 * Browser-side story data: what editors read (drafts included) and every
 * write they make. One interface, two implementations chosen at runtime:
 *
 *   live  → Supabase with the editor's own session; RLS decides.
 *   demo  → Kitty's demo book in localStorage, so every owner screen works
 *           (and can be verified) with no backend at all.
 *
 * Writes return the saved row so callers can reconcile optimistic state.
 */
import { DEMO_PET, demoStories } from "@/config/stories";
import { browserSupabase, liveMode } from "@/lib/supabase/browser";
import { MEDIA_BUCKET } from "@/lib/supabase/config";
import { imageToDataUrl, prepareImage, randomId } from "./media";
import {
  CHAPTER_COLUMNS,
  DEFAULT_BLEND,
  SCENE_COLUMNS,
  VOLUME_COLUMNS,
  assemble,
  chapterFromRow,
  petFromRow,
  sceneFromRow,
  volumeFromRow,
  type Chapter,
  type ChapterStatus,
  type ChapterSummary,
  type PetStories,
  type Scene,
  type TileBlend,
  type Volume,
} from "./types";

export interface VolumeInput {
  title: string;
  subtitle?: string | null;
  mood?: string | null;
  dateLabel?: string | null;
  storyDate?: string | null;
  body?: string[];
}

export interface ChapterInput {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  dateLabel?: string | null;
  storyDate?: string | null;
  tileImageA?: string | null;
  tileImageB?: string | null;
  tileBlend?: TileBlend;
  status?: ChapterStatus;
  volumeId?: string;
}

export interface SceneInput {
  kicker?: string | null;
  title?: string | null;
  beats?: string[];
  image?: string | null;
  focus?: { x: number; y: number } | null;
  frames?: { dir: string } | null;
  videoPrompt?: string | null;
  pinLength?: number;
}

export interface StoriesBackend {
  mode: "live" | "demo";
  /** Everything the caller may see: for editors that includes drafts. */
  loadStories(petSlug: string): Promise<PetStories | null>;
  loadChapter(petSlug: string, chapterId: string): Promise<Chapter | null>;
  createVolume(petId: string, input: VolumeInput, position: number, slug: string): Promise<Volume>;
  updateVolume(id: string, patch: Partial<VolumeInput>): Promise<Volume>;
  deleteVolume(id: string): Promise<void>;
  reorderVolumes(petId: string, ids: string[]): Promise<void>;
  createChapter(petId: string, volumeId: string, input: ChapterInput, position: number, slug: string): Promise<ChapterSummary>;
  updateChapter(id: string, patch: Partial<ChapterInput>): Promise<ChapterSummary>;
  deleteChapter(id: string): Promise<void>;
  reorderChapters(volumeId: string, ids: string[]): Promise<void>;
  saveScenes(chapterId: string, scenes: SceneInput[]): Promise<Scene[]>;
  /** Upload a photo; returns the stored reference (bucket path, or a data URL in demo). */
  uploadImage(petId: string, file: Blob, folder: string, maxEdge?: number): Promise<string>;
  /** Upload bytes as they are (clip frames, manifests) to pets/<petId>/<path>. Live only. */
  uploadBlob(petId: string, path: string, blob: Blob, contentType: string): Promise<string>;
  /** The owner's working notes for a chapter: what happened, the photos, Claude's draft. */
  loadBuild(chapterId: string): Promise<ChapterBuild | null>;
  saveBuild(chapterId: string, petId: string, build: ChapterBuild): Promise<void>;
}

export interface ChapterBuild {
  sourceText: string;
  photos: string[];
  draft: unknown;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function volumePatch(p: Partial<VolumeInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.title !== undefined) out.title = p.title.trim();
  if (p.subtitle !== undefined) out.subtitle = p.subtitle?.trim() || null;
  if (p.mood !== undefined) out.mood = p.mood?.trim() || null;
  if (p.dateLabel !== undefined) out.date_label = p.dateLabel?.trim() || null;
  if (p.storyDate !== undefined) out.story_date = p.storyDate || null;
  if (p.body !== undefined) out.body = p.body.map((s) => s.trim()).filter(Boolean);
  return out;
}

function chapterPatch(p: Partial<ChapterInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.title !== undefined) out.title = p.title.trim();
  if (p.subtitle !== undefined) out.subtitle = p.subtitle?.trim() || null;
  if (p.description !== undefined) out.description = p.description?.trim() || null;
  if (p.dateLabel !== undefined) out.date_label = p.dateLabel?.trim() || null;
  if (p.storyDate !== undefined) out.story_date = p.storyDate || null;
  if (p.tileImageA !== undefined) out.tile_image_a = p.tileImageA || null;
  if (p.tileImageB !== undefined) out.tile_image_b = p.tileImageB || null;
  if (p.tileBlend !== undefined) out.tile_blend = p.tileBlend;
  if (p.status !== undefined) out.status = p.status;
  if (p.volumeId !== undefined) out.volume_id = p.volumeId;
  return out;
}

function scenePatch(s: SceneInput, index: number): Record<string, unknown> {
  return {
    position: index,
    kicker: s.kicker?.trim() || null,
    title: s.title?.trim() || null,
    beats: (s.beats ?? []).map((b) => b.trim()).filter(Boolean),
    image: s.image || null,
    focus: s.focus ?? null,
    frames: s.frames ?? null,
    video_prompt: s.videoPrompt?.trim() || null,
    pin_length: s.pinLength ?? 2.2,
  };
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

// ── live ─────────────────────────────────────────────────────────────────────

const live: StoriesBackend = {
  mode: "live",

  async loadStories(petSlug) {
    const sb = browserSupabase();
    const { data: petRow, error } = await sb.from("pets").select("id, slug, name, tagline").eq("slug", petSlug).maybeSingle();
    if (error) fail("Loading the pet", error);
    if (!petRow) return null;
    const pet = petFromRow(petRow);
    const [v, c] = await Promise.all([
      sb.from("volumes").select(VOLUME_COLUMNS).eq("pet_id", pet.id).order("position"),
      sb.from("chapters").select(CHAPTER_COLUMNS).eq("pet_id", pet.id).order("position"),
    ]);
    if (v.error) fail("Loading volumes", v.error);
    if (c.error) fail("Loading chapters", c.error);
    return {
      pet,
      volumes: assemble((v.data ?? []).map(volumeFromRow), (c.data ?? []).map(chapterFromRow)),
      source: "supabase",
    };
  },

  async loadChapter(_petSlug, chapterId) {
    const sb = browserSupabase();
    const [c, s] = await Promise.all([
      sb.from("chapters").select(CHAPTER_COLUMNS).eq("id", chapterId).maybeSingle(),
      sb.from("chapter_scenes").select(SCENE_COLUMNS).eq("chapter_id", chapterId).order("position"),
    ]);
    if (c.error) fail("Loading the chapter", c.error);
    if (s.error) fail("Loading the scenes", s.error);
    if (!c.data) return null;
    return { ...chapterFromRow(c.data), scenes: (s.data ?? []).map(sceneFromRow) };
  },

  async createVolume(petId, input, position, slug) {
    const { data, error } = await browserSupabase()
      .from("volumes")
      .insert({ pet_id: petId, slug, position, ...volumePatch(input) })
      .select(VOLUME_COLUMNS)
      .single();
    if (error) fail("Adding the volume", error);
    return volumeFromRow(data);
  },

  async updateVolume(id, patch) {
    const { data, error } = await browserSupabase()
      .from("volumes")
      .update(volumePatch(patch))
      .eq("id", id)
      .select(VOLUME_COLUMNS)
      .single();
    if (error) fail("Saving the volume", error);
    return volumeFromRow(data);
  },

  async deleteVolume(id) {
    const { error } = await browserSupabase().from("volumes").delete().eq("id", id);
    if (error) fail("Deleting the volume", error);
  },

  async reorderVolumes(petId, ids) {
    const { error } = await browserSupabase().rpc("reorder_volumes", { p_pet: petId, p_ids: ids });
    if (error) fail("Saving the order", error);
  },

  async createChapter(petId, volumeId, input, position, slug) {
    const { data, error } = await browserSupabase()
      .from("chapters")
      .insert({
        pet_id: petId,
        volume_id: volumeId,
        slug,
        position,
        tile_blend: DEFAULT_BLEND,
        status: "draft",
        ...chapterPatch(input),
      })
      .select(CHAPTER_COLUMNS)
      .single();
    if (error) fail("Adding the chapter", error);
    return chapterFromRow(data);
  },

  async updateChapter(id, patch) {
    const { data, error } = await browserSupabase()
      .from("chapters")
      .update(chapterPatch(patch))
      .eq("id", id)
      .select(CHAPTER_COLUMNS)
      .single();
    if (error) fail("Saving the chapter", error);
    return chapterFromRow(data);
  },

  async deleteChapter(id) {
    const { error } = await browserSupabase().from("chapters").delete().eq("id", id);
    if (error) fail("Deleting the chapter", error);
  },

  async reorderChapters(volumeId, ids) {
    const { error } = await browserSupabase().rpc("reorder_chapters", { p_volume: volumeId, p_ids: ids });
    if (error) fail("Saving the order", error);
  },

  async saveScenes(chapterId, scenes) {
    const sb = browserSupabase();
    // Replace the set: scenes are few, and position is their identity here.
    const del = await sb.from("chapter_scenes").delete().eq("chapter_id", chapterId);
    if (del.error) fail("Saving the scenes", del.error);
    if (!scenes.length) return [];
    const { data, error } = await sb
      .from("chapter_scenes")
      .insert(scenes.map((s, i) => ({ chapter_id: chapterId, ...scenePatch(s, i) })))
      .select(SCENE_COLUMNS);
    if (error) fail("Saving the scenes", error);
    return (data ?? []).map(sceneFromRow).sort((a, b) => a.position - b.position);
  },

  async uploadImage(petId, file, folder, maxEdge = 1600) {
    const img = await prepareImage(file, maxEdge);
    const path = `pets/${petId}/${folder.replace(/^\/+|\/+$/g, "")}/${randomId()}.${img.ext}`;
    const { error } = await browserSupabase()
      .storage.from(MEDIA_BUCKET)
      .upload(path, img.blob, { contentType: img.type, cacheControl: "31536000", upsert: false });
    if (error) fail("Uploading the photo", error);
    return path;
  },

  async uploadBlob(petId, path, blob, contentType) {
    const full = `pets/${petId}/${path.replace(/^\/+/, "")}`;
    const { error } = await browserSupabase()
      .storage.from(MEDIA_BUCKET)
      .upload(full, blob, { contentType, cacheControl: "31536000", upsert: true });
    if (error) fail("Uploading", error);
    return full;
  },

  async loadBuild(chapterId) {
    const { data, error } = await browserSupabase()
      .from("chapter_builds")
      .select("source_text, photos, draft")
      .eq("chapter_id", chapterId)
      .maybeSingle();
    if (error) fail("Loading the chapter's notes", error);
    if (!data) return null;
    return { sourceText: (data.source_text as string) ?? "", photos: (data.photos as string[]) ?? [], draft: data.draft };
  },

  async saveBuild(chapterId, petId, build) {
    const { error } = await browserSupabase()
      .from("chapter_builds")
      .upsert(
        { chapter_id: chapterId, pet_id: petId, source_text: build.sourceText.slice(0, 6000), photos: build.photos.slice(0, 12), draft: build.draft },
        { onConflict: "chapter_id" },
      );
    if (error) fail("Saving the chapter's notes", error);
  },
};

// ── demo ─────────────────────────────────────────────────────────────────────

const DEMO_KEY = "kittyfive-demo-stories-v1";

interface DemoState {
  stories: PetStories;
  chapters: Record<string, Chapter>;
  builds?: Record<string, ChapterBuild>;
}

let demoState: DemoState | null = null;

function loadDemo(): DemoState {
  if (demoState) return demoState;
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (raw) {
      demoState = JSON.parse(raw) as DemoState;
      return demoState;
    }
  } catch {
    /* fall through to a fresh copy */
  }
  const fresh = demoStories();
  demoState = { stories: fresh.stories, chapters: Object.fromEntries(Object.values(fresh.chapters).map((c) => [c.id, c])) };
  return demoState;
}

function saveDemo() {
  if (!demoState) return;
  // Keep chapter summaries inside volumes in step with the chapter records.
  const byVolume = new Map<string, ChapterSummary[]>();
  for (const c of Object.values(demoState.chapters)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scenes, ...summary } = c;
    const list = byVolume.get(c.volumeId) ?? [];
    list.push(summary);
    byVolume.set(c.volumeId, list);
  }
  demoState.stories.volumes = demoState.stories.volumes
    .sort((a, b) => a.position - b.position)
    .map((v) => ({ ...v, chapters: (byVolume.get(v.id) ?? []).sort((a, b) => a.position - b.position) }));
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(demoState));
  } catch {
    /* quota or private mode: the edit lasts for this page */
  }
}

/** Forget demo edits and start again from the seed. */
export function resetDemoStories() {
  demoState = null;
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const demo: StoriesBackend = {
  mode: "demo",

  async loadStories(petSlug) {
    if (petSlug !== DEMO_PET.slug) return null;
    return clone(loadDemo().stories);
  },

  async loadChapter(_petSlug, chapterId) {
    const c = loadDemo().chapters[chapterId];
    return c ? clone(c) : null;
  },

  async createVolume(_petId, input, position, slug) {
    const s = loadDemo();
    const volume = {
      id: `demo-volume-${slug}-${randomId().slice(0, 6)}`,
      slug,
      position,
      title: input.title.trim(),
      subtitle: input.subtitle?.trim() || null,
      mood: input.mood?.trim() || null,
      dateLabel: input.dateLabel?.trim() || null,
      storyDate: input.storyDate || null,
      body: (input.body ?? []).filter(Boolean),
    };
    s.stories.volumes.push({ ...volume, chapters: [] });
    saveDemo();
    return clone(volume);
  },

  async updateVolume(id, patch) {
    const s = loadDemo();
    const v = s.stories.volumes.find((x) => x.id === id);
    if (!v) throw new Error("That volume no longer exists.");
    if (patch.title !== undefined) v.title = patch.title.trim();
    if (patch.subtitle !== undefined) v.subtitle = patch.subtitle?.trim() || null;
    if (patch.mood !== undefined) v.mood = patch.mood?.trim() || null;
    if (patch.dateLabel !== undefined) v.dateLabel = patch.dateLabel?.trim() || null;
    if (patch.storyDate !== undefined) v.storyDate = patch.storyDate || null;
    if (patch.body !== undefined) v.body = patch.body.map((b) => b.trim()).filter(Boolean);
    saveDemo();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chapters, ...volume } = v;
    return clone(volume);
  },

  async deleteVolume(id) {
    const s = loadDemo();
    s.stories.volumes = s.stories.volumes.filter((v) => v.id !== id);
    for (const [cid, c] of Object.entries(s.chapters)) if (c.volumeId === id) delete s.chapters[cid];
    saveDemo();
  },

  async reorderVolumes(_petId, ids) {
    const s = loadDemo();
    ids.forEach((id, i) => {
      const v = s.stories.volumes.find((x) => x.id === id);
      if (v) v.position = i;
    });
    saveDemo();
  },

  async createChapter(_petId, volumeId, input, position, slug) {
    const s = loadDemo();
    const chapter: Chapter = {
      id: `demo-chapter-${slug}-${randomId().slice(0, 6)}`,
      volumeId,
      slug,
      position,
      status: input.status ?? "draft",
      title: input.title.trim(),
      subtitle: input.subtitle?.trim() || null,
      description: input.description?.trim() || null,
      dateLabel: input.dateLabel?.trim() || null,
      storyDate: input.storyDate || null,
      tileImageA: input.tileImageA ?? null,
      tileImageB: input.tileImageB ?? null,
      tileBlend: input.tileBlend ?? { ...DEFAULT_BLEND },
      landingOrder: null,
      scenes: [],
    };
    s.chapters[chapter.id] = chapter;
    saveDemo();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scenes, ...summary } = chapter;
    return clone(summary);
  },

  async updateChapter(id, patch) {
    const s = loadDemo();
    const c = s.chapters[id];
    if (!c) throw new Error("That chapter no longer exists.");
    if (patch.title !== undefined) c.title = patch.title.trim();
    if (patch.subtitle !== undefined) c.subtitle = patch.subtitle?.trim() || null;
    if (patch.description !== undefined) c.description = patch.description?.trim() || null;
    if (patch.dateLabel !== undefined) c.dateLabel = patch.dateLabel?.trim() || null;
    if (patch.storyDate !== undefined) c.storyDate = patch.storyDate || null;
    if (patch.tileImageA !== undefined) c.tileImageA = patch.tileImageA || null;
    if (patch.tileImageB !== undefined) c.tileImageB = patch.tileImageB || null;
    if (patch.tileBlend !== undefined) c.tileBlend = patch.tileBlend;
    if (patch.status !== undefined) c.status = patch.status;
    if (patch.volumeId !== undefined && patch.volumeId !== c.volumeId) {
      c.volumeId = patch.volumeId;
      c.position = Object.values(s.chapters).filter((x) => x.volumeId === patch.volumeId).length;
    }
    saveDemo();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scenes, ...summary } = c;
    return clone(summary);
  },

  async deleteChapter(id) {
    const s = loadDemo();
    delete s.chapters[id];
    saveDemo();
  },

  async reorderChapters(volumeId, ids) {
    const s = loadDemo();
    ids.forEach((id, i) => {
      const c = s.chapters[id];
      if (c) {
        c.position = i;
        c.volumeId = volumeId;
      }
    });
    saveDemo();
  },

  async saveScenes(chapterId, scenes) {
    const s = loadDemo();
    const c = s.chapters[chapterId];
    if (!c) throw new Error("That chapter no longer exists.");
    c.scenes = scenes.map((x, i) => ({
      id: `demo-scene-${randomId().slice(0, 8)}`,
      position: i,
      kicker: x.kicker ?? null,
      title: x.title ?? null,
      beats: (x.beats ?? []).filter(Boolean),
      image: x.image ?? null,
      focus: x.focus ?? null,
      frames: x.frames ?? null,
      videoPrompt: x.videoPrompt ?? null,
      pinLength: x.pinLength ?? 2.2,
      transition: "crossfade",
    }));
    saveDemo();
    return clone(c.scenes);
  },

  async uploadImage(_petId, file) {
    return imageToDataUrl(file);
  },

  async uploadBlob() {
    throw new Error("Clips are stored on the live site only. Demo mode keeps edits in this browser, which is too small for a clip's frames.");
  },

  async loadBuild(chapterId) {
    const b = loadDemo().builds?.[chapterId];
    return b ? clone(b) : null;
  },

  async saveBuild(chapterId, _petId, build) {
    const s = loadDemo();
    s.builds = { ...(s.builds ?? {}), [chapterId]: clone(build) };
    saveDemo();
  },
};

export function storiesBackend(): StoriesBackend {
  return liveMode() ? live : demo;
}
