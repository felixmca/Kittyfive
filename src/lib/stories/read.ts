/**
 * Server-side reads for the Stories pages. Everything here runs with the
 * anonymous key, so it returns exactly what a visitor may see: public pets,
 * their volumes, and published chapters. Editors fetch drafts in the browser
 * with their own session (see client.ts).
 *
 * Demo mode (no Supabase, or ?demo=1) serves Kitty's book from
 * src/config/stories.ts. So does the flagship pet when the database has not
 * been seeded yet, which is what a fresh self-hosted install looks like.
 */
import { DEMO_PET, demoStories } from "@/config/stories";
import { serverSupabase } from "@/lib/supabase/server";
import {
  CHAPTER_COLUMNS,
  SCENE_COLUMNS,
  VOLUME_COLUMNS,
  assemble,
  chapterFromRow,
  petFromRow,
  readingOrder,
  sceneFromRow,
  volumeFromRow,
  type Chapter,
  type ChapterSummary,
  type PetStories,
  type ReadingEntry,
  type Scene,
} from "./types";

export interface LoadOptions {
  demo?: boolean;
}

export async function loadPetStories(petSlug: string, opts: LoadOptions = {}): Promise<PetStories | null> {
  const sb = opts.demo ? null : serverSupabase();
  if (!sb) return petSlug === DEMO_PET.slug ? demoStories().stories : null;

  const { data: petRow, error: petError } = await sb
    .from("pets")
    .select("id, slug, name, tagline")
    .eq("slug", petSlug)
    .maybeSingle();
  if (petError) throw new Error(`pets: ${petError.message}`);
  if (!petRow) return petSlug === DEMO_PET.slug ? demoStories().stories : null;

  const pet = petFromRow(petRow);
  const [volumes, chapters] = await Promise.all([
    sb.from("volumes").select(VOLUME_COLUMNS).eq("pet_id", pet.id).order("position"),
    sb.from("chapters").select(CHAPTER_COLUMNS).eq("pet_id", pet.id).order("position"),
  ]);
  if (volumes.error) throw new Error(`volumes: ${volumes.error.message}`);
  if (chapters.error) throw new Error(`chapters: ${chapters.error.message}`);

  return {
    pet,
    volumes: assemble(
      (volumes.data ?? []).map(volumeFromRow),
      (chapters.data ?? []).map(chapterFromRow),
    ),
    source: "supabase",
  };
}

export interface ReaderData {
  stories: PetStories;
  reading: ReadingEntry[];
  /** Index into `reading` of the chapter asked for. */
  index: number;
  /** The chapter asked for plus its neighbours, with scenes, keyed by chapter id. */
  chapters: Record<string, Chapter>;
}

/** The chapter, its place in the reading order, and its neighbours' scenes. */
export async function loadReader(
  petSlug: string,
  chapterSlug: string,
  opts: LoadOptions = {},
): Promise<ReaderData | null> {
  const stories = await loadPetStories(petSlug, opts);
  if (!stories) return null;
  const reading = readingOrder(stories.volumes);
  const index = reading.findIndex((r) => r.slug === chapterSlug);
  if (index < 0) return null;

  const wanted = [index - 1, index, index + 1]
    .filter((i) => i >= 0 && i < reading.length)
    .map((i) => reading[i].chapterId);
  const summaries = new Map<string, ChapterSummary>();
  for (const v of stories.volumes) for (const c of v.chapters) summaries.set(c.id, c);

  const scenesByChapter = await loadScenes(stories, wanted, opts);
  const chapters: Record<string, Chapter> = {};
  for (const id of wanted) {
    const summary = summaries.get(id);
    if (summary) chapters[id] = { ...summary, scenes: scenesByChapter.get(id) ?? [] };
  }
  return { stories, reading, index, chapters };
}

async function loadScenes(
  stories: PetStories,
  chapterIds: string[],
  opts: LoadOptions,
): Promise<Map<string, Scene[]>> {
  const out = new Map<string, Scene[]>();
  if (!chapterIds.length) return out;

  if (stories.source === "demo") {
    const { chapters } = demoStories();
    for (const c of Object.values(chapters)) {
      if (chapterIds.includes(c.id)) out.set(c.id, c.scenes);
    }
    return out;
  }

  const sb = opts.demo ? null : serverSupabase();
  if (!sb) return out;
  const { data, error } = await sb
    .from("chapter_scenes")
    .select(SCENE_COLUMNS)
    .in("chapter_id", chapterIds)
    .order("position");
  if (error) throw new Error(`chapter_scenes: ${error.message}`);
  for (const row of data ?? []) {
    const id = String((row as Record<string, unknown>).chapter_id);
    const list = out.get(id) ?? [];
    list.push(sceneFromRow(row));
    out.set(id, list);
  }
  return out;
}
