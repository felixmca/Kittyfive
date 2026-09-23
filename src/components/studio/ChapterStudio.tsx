"use client";
/**
 * The chapter studio (pillar 1): make a chapter from a few photos and a few
 * sentences, then bring it to life one clip at a time.
 *
 *   1. Compose: pick the volume, add photos (resized in the browser, stored
 *      in the pet's folder), say what happened.
 *   2. Draft: Claude reads the photos and the words and writes the chapter
 *      (title, tile text, 2–6 scenes with their lines, a focus point and a
 *      Kling prompt each). Or skip it and write it yourself.
 *   3. Review and save: edit anything; the chapter works at once as a photo
 *      story (each photo pushed in slowly as you scroll). Drafts stay private.
 *   4. Clips: for each scene, copy the prompt, download the 9:16 start frame,
 *      make the clip on artta (no API, so by hand), and drop it back here. It
 *      is cut into frames in this browser and the scene starts to move.
 *
 * /stories/new?volume=<slug> starts at 1; /stories/<chapter>/edit opens any
 * chapter (the six landing chapters included) at 3.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chrome from "@/components/chrome/Chrome";
import TileFace from "@/components/stories/TileFace";
import TileEditor, { emptyDraft, type TileDraft } from "@/components/stories/TileEditor";
import SceneCard, { type ClipProgress, type StudioScene } from "./SceneCard";
import { SITE } from "@/config/site";
import { accessToken, useAuth } from "@/lib/auth/store";
import { useUi } from "@/lib/store";
import { storiesBackend, type SceneInput } from "@/lib/stories/client";
import type { ChapterDraft } from "@/lib/stories/draft";
import { randomId } from "@/lib/stories/media";
import { cutFrames, pool } from "@/lib/studio/frames";
import { mediaUrl } from "@/lib/supabase/config";
import { uniqueSlug, type ChapterStatus, type PetStories } from "@/lib/stories/types";

type Gate = "loading" | "signin" | "forbidden" | "missing" | "ready";

interface Props {
  mode: "new" | "edit";
  chapterSlug?: string;
  volumeSlug?: string;
}

const FIELD =
  "w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-[15px] text-fg placeholder:text-white/30 outline-none transition-colors focus:border-accent/70 focus:bg-white/[0.07]";
const LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted";
const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-5 text-[15px] text-fg transition-colors hover:border-white/35 disabled:opacity-50";

const MAX_PHOTOS = 12;

const DEFAULT_PROMPT =
  "Very slow push-in. The black-and-white cat in the image makes one small, natural movement from exactly this pose (a slow blink, a turn of the head, ears moving), then settles. Keep her markings, the room and the light exactly as in the photo. Photoreal, smooth steady camera, one continuous shot.";

function demoQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("demo") === "1" ? "?demo=1" : "";
}

function toSceneInput(s: StudioScene): SceneInput {
  return {
    kicker: s.kicker,
    beats: s.beats.split("\n"),
    image: s.image,
    focus: s.focus,
    frames: s.frames,
    videoPrompt: s.videoPrompt,
    pinLength: s.pinLength,
  };
}

export default function ChapterStudio({ mode, chapterSlug, volumeSlug }: Props) {
  const router = useRouter();
  const auth = useAuth();
  const showToast = useUi((s) => s.showToast);
  const [gate, setGate] = useState<Gate>("loading");
  const [stories, setStories] = useState<PetStories | null>(null);
  const [step, setStep] = useState<"compose" | "review">(mode === "new" ? "compose" : "review");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(chapterSlug ?? null);
  const [savedVolumeId, setSavedVolumeId] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [text, setText] = useState("");
  const [lastDraft, setLastDraft] = useState<unknown>(null);
  const [tile, setTile] = useState<TileDraft>(emptyDraft(""));
  const [scenes, setScenes] = useState<StudioScene[]>([]);
  const [tileOpen, setTileOpen] = useState(false);
  const [busy, setBusy] = useState<null | "draft" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [progress, setProgress] = useState<Record<string, ClipProgress>>({});
  const [draftKey] = useState(() => randomId());
  // Clips need real storage: live mode only (set once the backend is known).
  const [clipsAllowed, setClipsAllowed] = useState(false);
  const scenesRef = useRef<StudioScene[]>([]);
  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);

  useEffect(() => {
    auth.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Who may be here, and what we are editing.
  useEffect(() => {
    if (!auth.ready) return;
    if (!auth.user) {
      setGate("signin");
      return;
    }
    let cancelled = false;
    (async () => {
      const backend = storiesBackend();
      setClipsAllowed(backend.mode === "live");
      const s = await backend.loadStories(SITE.petSlug);
      if (cancelled) return;
      if (!s) return setGate("missing");
      if (!(await auth.canEdit(s.pet.id))) return setGate("forbidden");
      setStories(s);
      if (mode === "new") {
        const v = s.volumes.find((x) => x.slug === volumeSlug) ?? s.volumes[s.volumes.length - 1];
        setTile(emptyDraft(v?.id ?? ""));
        setSavedVolumeId("");
        return setGate("ready");
      }
      const summary = s.volumes.flatMap((v) => v.chapters).find((c) => c.slug === chapterSlug);
      if (!summary) return setGate("missing");
      const [chapter, build] = await Promise.all([
        backend.loadChapter(s.pet.slug, summary.id),
        backend.loadBuild(summary.id).catch(() => null),
      ]);
      if (cancelled) return;
      if (!chapter) return setGate("missing");
      setChapterId(chapter.id);
      setSlug(chapter.slug);
      setSavedVolumeId(chapter.volumeId);
      setTile({
        title: chapter.title,
        subtitle: chapter.subtitle ?? "",
        description: chapter.description ?? "",
        dateLabel: chapter.dateLabel ?? "",
        storyDate: chapter.storyDate ?? "",
        tileImageA: chapter.tileImageA,
        tileImageB: chapter.tileImageB,
        tileBlend: chapter.tileBlend,
        status: chapter.status,
        volumeId: chapter.volumeId,
      });
      setScenes(
        chapter.scenes.map((sc) => ({
          key: sc.id,
          image: sc.image,
          focus: sc.focus,
          kicker: sc.kicker ?? "",
          beats: sc.beats.join("\n"),
          videoPrompt: sc.videoPrompt ?? "",
          frames: sc.frames,
          pinLength: sc.pinLength,
        })),
      );
      const refs = [...(build?.photos ?? [])];
      for (const sc of chapter.scenes) if (sc.image && !refs.includes(sc.image)) refs.push(sc.image);
      setPhotos(refs);
      setText(build?.sourceText ?? "");
      setLastDraft(build?.draft ?? null);
      setGate("ready");
    })().catch((e: Error) => {
      if (!cancelled) {
        setError(e.message);
        setGate("missing");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, auth.user?.id, mode, chapterSlug, volumeSlug]);

  // Unsaved work: ask before leaving.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const allSlugs = useMemo(
    () => (stories?.volumes ?? []).flatMap((v) => v.chapters.map((c) => c.slug)),
    [stories],
  );
  const volumes = useMemo(() => (stories?.volumes ?? []).map((v) => ({ id: v.id, title: v.title })), [stories]);

  // ── photos ──────────────────────────────────────────────────────────────

  async function addPhotos(files: FileList | null) {
    if (!files || !stories) return;
    const list = Array.from(files).slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    if (!list.length) return setError(`Up to ${MAX_PHOTOS} photos per chapter.`);
    setError(null);
    setUploading((n) => n + list.length);
    const backend = storiesBackend();
    await pool(list, 3, async (file) => {
      try {
        const ref = await backend.uploadImage(stories.pet.id, file, `chapters/${chapterId ?? draftKey}/photos`, 2048);
        setPhotos((p) => [...p, ref]);
        setDirty(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "A photo did not upload.");
      } finally {
        setUploading((n) => n - 1);
      }
    });
  }

  function removePhoto(ref: string) {
    setPhotos((p) => p.filter((x) => x !== ref));
    setDirty(true);
  }

  // ── drafting ────────────────────────────────────────────────────────────

  function applyDraft(d: ChapterDraft) {
    const photoAt = (i: number) => photos[i] ?? null;
    setTile((t) => ({
      ...t,
      title: d.title,
      subtitle: d.subtitle,
      description: d.description,
      dateLabel: d.dateLabel || t.dateLabel,
      tileImageA: t.tileImageA ?? photoAt(d.scenes[0]?.photo ?? 0),
      tileImageB: t.tileImageB ?? (d.scenes.length > 1 ? photoAt(d.scenes[1].photo) : null),
    }));
    setScenes(
      d.scenes.map((s) => ({
        key: randomId(),
        image: photoAt(s.photo),
        focus: s.focus,
        kicker: s.kicker,
        beats: s.beats.join("\n"),
        videoPrompt: s.videoPrompt,
        frames: null,
        pinLength: 2.2,
      })),
    );
    setDirty(true);
  }

  async function draftWithClaude() {
    if (!stories) return;
    if (!text.trim()) return setError("Write a few sentences about what happened first.");
    setBusy("draft");
    setError(null);
    try {
      const backend = storiesBackend();
      const token = await accessToken();
      const res = await fetch("/api/chapters/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          petId: stories.pet.id,
          photos: backend.mode === "demo" ? [] : photos.map((p) => mediaUrl(p)).filter(Boolean),
          photoCount: photos.length,
          text,
          volumeId: tile.volumeId,
          demo: backend.mode === "demo",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { draft?: ChapterDraft; error?: string };
      if (!res.ok || !json.draft) throw new Error(json.error ?? `The draft failed (HTTP ${res.status}).`);
      applyDraft(json.draft);
      setLastDraft(json.draft);
      setStep("review");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The draft failed.");
    } finally {
      setBusy(null);
    }
  }

  function writeItMyself() {
    setScenes(
      (photos.length ? photos : [null]).map((p) => ({
        key: randomId(),
        image: p,
        focus: null,
        kicker: "",
        beats: "",
        videoPrompt: DEFAULT_PROMPT,
        frames: null,
        pinLength: 2.2,
      })),
    );
    setTile((t) => ({ ...t, tileImageA: t.tileImageA ?? photos[0] ?? null, tileImageB: t.tileImageB ?? photos[1] ?? null }));
    setStep("review");
    setDirty(true);
    window.scrollTo({ top: 0 });
  }

  // ── scenes ──────────────────────────────────────────────────────────────

  const patchScene = useCallback((key: string, patch: Partial<StudioScene>) => {
    setScenes((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  }, []);

  function moveScene(index: number, delta: -1 | 1) {
    setScenes((list) => {
      const to = index + delta;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [s] = next.splice(index, 1);
      next.splice(to, 0, s);
      return next;
    });
    setDirty(true);
  }

  function addScene() {
    setScenes((list) => [
      ...list,
      { key: randomId(), image: photos.find((p) => !list.some((s) => s.image === p)) ?? null, focus: null, kicker: "", beats: "", videoPrompt: DEFAULT_PROMPT, frames: null, pinLength: 2.2 },
    ]);
    setDirty(true);
  }

  // ── saving ──────────────────────────────────────────────────────────────

  async function save(status: ChapterStatus = tile.status) {
    if (!stories) return;
    if (!tile.title.trim()) return setError("Give the chapter a title (Edit the tile).");
    setBusy("save");
    setError(null);
    try {
      const backend = storiesBackend();
      const input = {
        title: tile.title,
        subtitle: tile.subtitle,
        description: tile.description,
        dateLabel: tile.dateLabel,
        storyDate: tile.storyDate,
        tileImageA: tile.tileImageA,
        tileImageB: tile.tileImageB,
        tileBlend: tile.tileBlend,
        status,
      };
      let id = chapterId;
      let currentSlug = slug;
      if (!id) {
        const volume = stories.volumes.find((v) => v.id === tile.volumeId);
        const created = await backend.createChapter(
          stories.pet.id,
          tile.volumeId,
          input,
          volume?.chapters.length ?? 0,
          uniqueSlug(tile.title, allSlugs, "chapter"),
        );
        id = created.id;
        currentSlug = created.slug;
      } else {
        const moving = tile.volumeId !== savedVolumeId;
        await backend.updateChapter(id, { ...input, ...(moving ? { volumeId: tile.volumeId } : {}) });
        if (moving) {
          const target = stories.volumes.find((v) => v.id === tile.volumeId);
          await backend.reorderChapters(tile.volumeId, [...(target?.chapters.map((c) => c.id) ?? []).filter((x) => x !== id), id]);
        }
      }
      await backend.saveScenes(id, scenesRef.current.map(toSceneInput));
      await backend.saveBuild(id, stories.pet.id, { sourceText: text, photos, draft: lastDraft }).catch(() => undefined);
      setChapterId(id);
      setSlug(currentSlug);
      setSavedVolumeId(tile.volumeId);
      setTile((t) => ({ ...t, status }));
      setDirty(false);
      showToast(status === "published" ? "Saved. Everyone can read it." : "Saved as a draft. Only you can see it.");
      if (mode === "new" && currentSlug) router.replace(`/stories/${currentSlug}/edit${demoQuery()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  // ── clips ───────────────────────────────────────────────────────────────

  async function addClip(sceneKey: string, file: File) {
    if (!stories || !chapterId) return;
    const backend = storiesBackend();
    const set = (p: ClipProgress | null) =>
      setProgress((all) => {
        const next = { ...all };
        if (p) next[sceneKey] = p;
        else delete next[sceneKey];
        return next;
      });
    setError(null);
    set({ phase: "cutting", done: 0, total: 72 });
    try {
      const cut = await cutFrames(file, { onProgress: (done, total) => set({ phase: "cutting", done, total }) });
      // A fresh folder per upload, so no CDN ever serves an old frame.
      const folder = `chapters/${chapterId}/scenes/${sceneKey.slice(0, 8)}-${randomId().slice(0, 8)}`;
      let uploaded = 0;
      set({ phase: "uploading", done: 0, total: cut.blobs.length });
      await pool(cut.blobs, 6, async (blob, i) => {
        await backend.uploadBlob(stories.pet.id, `${folder}/${String(i + 1).padStart(4, "0")}.${cut.ext}`, blob, blob.type || `image/${cut.ext === "jpg" ? "jpeg" : "webp"}`);
        uploaded++;
        set({ phase: "uploading", done: uploaded, total: cut.blobs.length });
      });
      const manifest = { frames: cut.blobs.length, width: cut.width, height: cut.height, pattern: `%04d.${cut.ext}` };
      const stored = await backend.uploadBlob(
        stories.pet.id,
        `${folder}/manifest.json`,
        new Blob([JSON.stringify(manifest)], { type: "application/json" }),
        "application/json",
      );
      const dir = stored.replace(/\/manifest\.json$/, "");
      const next = scenesRef.current.map((s) => (s.key === sceneKey ? { ...s, frames: { dir } } : s));
      setScenes(next);
      await backend.saveScenes(chapterId, next.map(toSceneInput));
      showToast("The clip is in. Scroll the chapter to see it move.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The clip did not go in.");
    } finally {
      set(null);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────

  const preview = {
    slug: slug ?? "new-chapter",
    title: tile.title,
    subtitle: tile.subtitle || null,
    description: tile.description || null,
    dateLabel: tile.dateLabel || null,
    storyDate: tile.storyDate || null,
    tileImageA: tile.tileImageA,
    tileImageB: tile.tileImageB,
    tileBlend: tile.tileBlend,
    status: tile.status,
  };

  return (
    <>
      <Chrome />
      <main
        className="mx-auto w-full max-w-[880px] px-4 pb-40 sm:px-6"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + 84px)" }}
        data-studio={mode}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
          <Link href={`/stories${demoQuery()}`} className="hover:underline">{SITE.name} Stories</Link>
        </p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg sm:text-[52px]">
          {mode === "new" && !chapterId ? "A new chapter" : tile.title || "Edit chapter"}
        </h1>

        {gate === "loading" ? <p className="mt-8 text-muted">One moment…</p> : null}
        {gate === "signin" ? (
          <p className="mt-8 text-[15px] text-muted">
            <Link href="/account" className="text-accent underline-offset-4 hover:underline">Sign in</Link> to make chapters.
          </p>
        ) : null}
        {gate === "forbidden" ? (
          <p className="mt-8 text-[15px] text-muted" data-studio-forbidden>
            Only this pet&apos;s owner can make chapters here.
          </p>
        ) : null}
        {gate === "missing" ? <p className="mt-8 text-[15px] text-muted">That chapter could not be found.</p> : null}

        {gate === "ready" && step === "compose" ? (
          <section className="mt-8 flex flex-col gap-7" data-studio-compose>
            <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted">
              Add a few photos from the moment and say what happened, the way you would tell a friend. Claude drafts the
              chapter and writes a Kling prompt for each photo; you change anything you like.
            </p>
            <div>
              <label className={LABEL} htmlFor="studio-volume">Volume</label>
              <select
                id="studio-volume"
                className={`${FIELD} [color-scheme:dark]`}
                value={tile.volumeId}
                onChange={(e) => setTile((t) => ({ ...t, volumeId: e.target.value }))}
              >
                {volumes.map((v, i) => (
                  <option key={v.id} value={v.id}>{`Volume ${i + 1} · ${v.title}`}</option>
                ))}
              </select>
            </div>
            <PhotoTray photos={photos} uploading={uploading} onAdd={addPhotos} onRemove={removePhoto} />
            <div>
              <label className={LABEL} htmlFor="studio-text">What happened?</label>
              <textarea
                id="studio-text"
                className={`${FIELD} min-h-[180px] resize-y leading-relaxed`}
                value={text}
                maxLength={4000}
                placeholder="Where you were, what she did, how it ended. A few sentences is plenty."
                onChange={(e) => {
                  setText(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            {error ? <ErrorNote message={error} /> : null}
            <div className="flex flex-wrap gap-3">
              <button type="button" className={PRIMARY} onClick={draftWithClaude} disabled={busy !== null || uploading > 0 || !text.trim()} data-draft>
                {busy === "draft" ? "Claude is reading your photos…" : "Draft it with Claude"}
              </button>
              <button type="button" className={SECONDARY} onClick={writeItMyself} disabled={busy !== null || uploading > 0} data-write-myself>
                I&apos;ll write it myself
              </button>
            </div>
          </section>
        ) : null}

        {gate === "ready" && step === "review" ? (
          <section className="mt-8 flex flex-col gap-8" data-studio-review>
            <div className="grid gap-5 sm:grid-cols-[220px_1fr] sm:items-start">
              <div className="mx-auto aspect-[3/4] w-[200px] overflow-hidden rounded-[22px] ring-1 ring-white/12 sm:w-full">
                <TileFace data={preview} eager />
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-relaxed text-muted">
                  The tile is the chapter&apos;s cover on the Stories page and its opening screen when someone reads it.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={SECONDARY} onClick={() => setTileOpen(true)} data-edit-tile>
                    Edit the tile
                  </button>
                  {mode === "new" && !chapterId ? (
                    <button type="button" className={SECONDARY} onClick={() => setStep("compose")}>
                      Back to photos and words
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <PhotoTray photos={photos} uploading={uploading} onAdd={addPhotos} onRemove={removePhoto} compact />

            <div className="flex flex-col gap-4">
              <h2 className="font-display text-[26px] font-light text-fg">Scenes</h2>
              {scenes.length === 0 ? (
                <p className="text-[15px] text-muted">No scenes yet. A chapter with none shows only its cover.</p>
              ) : null}
              {scenes.map((scene, i) => (
                <SceneCard
                  key={scene.key}
                  scene={scene}
                  index={i}
                  count={scenes.length}
                  photos={photos}
                  chapterSaved={Boolean(chapterId)}
                  clipsAllowed={clipsAllowed}
                  progress={progress[scene.key] ?? null}
                  onChange={(patch) => patchScene(scene.key, patch)}
                  onMove={(d) => moveScene(i, d)}
                  onRemove={() => {
                    setScenes((list) => list.filter((s) => s.key !== scene.key));
                    setDirty(true);
                  }}
                  onClip={(file) => addClip(scene.key, file)}
                />
              ))}
              <button type="button" className={`${SECONDARY} self-start`} onClick={addScene} data-add-scene>
                + Add a scene
              </button>
            </div>

            {text ? (
              <details className="rounded-2xl border border-white/10 p-4">
                <summary className="cursor-pointer text-[14px] text-muted">What happened, in your words</summary>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg/85">{text}</p>
              </details>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
          </section>
        ) : null}
      </main>

      {gate === "ready" && step === "review" ? (
        <div
          className="fixed inset-x-0 bottom-0 z-[45] border-t border-white/10 bg-[#0b0b0c]/92 backdrop-blur-md"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          data-studio-bar
        >
          <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6">
            <p className="text-[13px] text-muted">
              {busy === "save" ? "Saving…" : dirty ? "Unsaved changes" : chapterId ? (tile.status === "published" ? "Published" : "Draft, only you can see it") : "Not saved yet"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {chapterId && slug ? (
                <Link href={`/stories/${slug}${demoQuery()}`} className="px-3 py-2 text-[14px] text-fg/80 hover:text-fg">
                  Read it →
                </Link>
              ) : null}
              <button type="button" className={SECONDARY} onClick={() => save("draft")} disabled={busy !== null} data-save-draft>
                Save draft
              </button>
              <button type="button" className={PRIMARY} onClick={() => save("published")} disabled={busy !== null} data-publish>
                {tile.status === "published" ? "Save" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tileOpen && stories ? (
        <TileEditor
          mode="edit"
          slug={slug ?? "new-chapter"}
          volumes={volumes}
          initial={tile}
          onUpload={(file) => storiesBackend().uploadImage(stories.pet.id, file, "tiles")}
          onSave={async (draft) => {
            setTile(draft);
            setDirty(true);
            setTileOpen(false);
          }}
          onClose={() => setTileOpen(false)}
        />
      ) : null}
    </>
  );
}

function PhotoTray({
  photos,
  uploading,
  onAdd,
  onRemove,
  compact = false,
}: {
  photos: string[];
  uploading: number;
  onAdd: (files: FileList | null) => void;
  onRemove: (ref: string) => void;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div data-photo-tray>
      <p className={LABEL}>{compact ? "Photos for this chapter" : "Photos"}</p>
      <div className="flex flex-wrap gap-2.5">
        {photos.map((p, i) => {
          const u = mediaUrl(p);
          return (
            <div key={p} className="group relative h-24 w-[72px] overflow-hidden rounded-xl bg-[#141416] ring-1 ring-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {u ? <img src={u} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" draggable={false} /> : null}
              <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-fg/90">{i + 1}</span>
              <button
                type="button"
                onClick={() => onRemove(p)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[12px] text-fg/90 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="flex h-24 w-[72px] items-center justify-center rounded-xl ring-1 ring-white/10">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white/50" />
          </div>
        ))}
        {photos.length + uploading < MAX_PHOTOS ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-24 w-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 text-[12px] text-muted transition-colors hover:border-white/45 hover:text-fg"
            data-add-photos
          >
            <span className="text-[20px] leading-none">+</span>
            Add
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[14px] text-red-200" data-studio-error>
      {message}
    </p>
  );
}
