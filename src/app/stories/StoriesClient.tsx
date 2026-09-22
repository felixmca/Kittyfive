"use client";
/**
 * /stories: the pet's book. Volumes in reading order, each with its story
 * (expandable) and a grid of chapter tiles that open the chapter reader.
 *
 * Editors (the pet's owner, or an admin) get an Edit switch: tiles become
 * draggable (RippleGrid) and tappable (TileEditor), volumes can be added,
 * edited, moved and deleted. Every edit is optimistic and saved through the
 * stories backend; RLS decides whether it sticks. A failed save puts the page
 * back the way the server has it and says why.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Chrome from "@/components/chrome/Chrome";
import RippleGrid, { type TileRenderState } from "@/components/stories/RippleGrid";
import TileFace from "@/components/stories/TileFace";
import TileEditor, { emptyDraft, type TileDraft } from "@/components/stories/TileEditor";
import VolumeEditor, { EMPTY_VOLUME, bodyToText, textToBody, type VolumeDraft } from "@/components/stories/VolumeEditor";
import { SITE } from "@/config/site";
import { useAuth } from "@/lib/auth/store";
import { useUi } from "@/lib/store";
import { storiesBackend } from "@/lib/stories/client";
import {
  readingOrder,
  storyDateText,
  uniqueSlug,
  type ChapterSummary,
  type PetStories,
  type VolumeWithChapters,
} from "@/lib/stories/types";

type Editor =
  | { kind: "chapter"; mode: "create"; volumeId: string }
  | { kind: "chapter"; mode: "edit"; chapter: ChapterSummary }
  | { kind: "volume"; mode: "create" }
  | { kind: "volume"; mode: "edit"; volume: VolumeWithChapters };

export default function StoriesClient({ initial }: { initial: PetStories }) {
  const router = useRouter();
  const [stories, setStories] = useState<PetStories>(initial);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const showToast = useUi((s) => s.showToast);
  const auth = useAuth();

  useEffect(() => {
    auth.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server props change after router.refresh(). Visitors adopt them; editors
  // keep their own copy, which (unlike the server's) includes drafts.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    if (!canEdit) setStories(initial);
  }

  // Editors see drafts too: reload with their session. Demo mode keeps its
  // edits in this browser, so always reload from there.
  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;
    (async () => {
      const backend = storiesBackend();
      const allowed = auth.user ? await auth.canEdit(initial.pet.id) : false;
      if (cancelled) return;
      setCanEdit(allowed);
      if (!allowed) setEditing(false);
      if (allowed || backend.mode === "demo") {
        try {
          const fresh = await backend.loadStories(initial.pet.slug);
          if (!cancelled && fresh) setStories(fresh);
        } catch (e) {
          console.warn("[stories] reload failed", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, auth.user?.id, initial.pet.id, initial.pet.slug]);

  const reading = useMemo(() => readingOrder(stories.volumes), [stories.volumes]);
  const firstPublished = useMemo(() => {
    for (const v of stories.volumes) for (const c of v.chapters) if (c.status === "published") return c.slug;
    return reading[0]?.slug ?? null;
  }, [stories.volumes, reading]);

  const resync = useCallback(
    async (message?: string) => {
      if (message) showToast(message, 4200);
      try {
        const fresh = await storiesBackend().loadStories(stories.pet.slug);
        if (fresh) setStories(fresh);
      } catch {
        /* keep what we have */
      }
      router.refresh();
    },
    [router, showToast, stories.pet.slug],
  );

  // ── chapters ────────────────────────────────────────────────────────────

  const reorderChapters = useCallback(
    (volumeId: string, ids: string[]) => {
      setStories((s) => ({
        ...s,
        volumes: s.volumes.map((v) =>
          v.id !== volumeId
            ? v
            : {
                ...v,
                chapters: ids
                  .map((id) => v.chapters.find((c) => c.id === id))
                  .filter((c): c is ChapterSummary => Boolean(c))
                  .map((c, i) => ({ ...c, position: i })),
              },
        ),
      }));
      storiesBackend()
        .reorderChapters(volumeId, ids)
        .then(() => router.refresh())
        .catch((e: Error) => resync(`The new order did not save. ${e.message}`));
    },
    [resync, router],
  );

  const allChapterSlugs = useMemo(
    () => stories.volumes.flatMap((v) => v.chapters.map((c) => c.slug)),
    [stories.volumes],
  );

  async function saveChapter(draft: TileDraft, existing?: ChapterSummary) {
    const backend = storiesBackend();
    const input = {
      title: draft.title,
      subtitle: draft.subtitle,
      description: draft.description,
      dateLabel: draft.dateLabel,
      storyDate: draft.storyDate,
      tileImageA: draft.tileImageA,
      tileImageB: draft.tileImageB,
      tileBlend: draft.tileBlend,
      status: draft.status,
    };
    if (!existing) {
      const volume = stories.volumes.find((v) => v.id === draft.volumeId);
      const slug = uniqueSlug(draft.title, allChapterSlugs, "chapter");
      const created = await backend.createChapter(stories.pet.id, draft.volumeId, input, volume?.chapters.length ?? 0, slug);
      setStories((s) => ({
        ...s,
        volumes: s.volumes.map((v) => (v.id === draft.volumeId ? { ...v, chapters: [...v.chapters, created] } : v)),
      }));
      showToast(draft.status === "published" ? "Chapter added." : "Chapter added as a draft. Only you can see it.");
    } else {
      const moving = draft.volumeId !== existing.volumeId;
      const saved = await backend.updateChapter(existing.id, { ...input, ...(moving ? { volumeId: draft.volumeId } : {}) });
      if (moving) {
        const target = stories.volumes.find((v) => v.id === draft.volumeId);
        const ids = [...(target?.chapters.map((c) => c.id) ?? []).filter((id) => id !== existing.id), existing.id];
        await backend.reorderChapters(draft.volumeId, ids);
      }
      setStories((s) => ({
        ...s,
        volumes: s.volumes.map((v) => {
          const without = v.chapters.filter((c) => c.id !== existing.id);
          if (v.id === saved.volumeId) {
            const present = v.chapters.some((c) => c.id === existing.id);
            return {
              ...v,
              chapters: present
                ? v.chapters.map((c) => (c.id === existing.id ? saved : c))
                : [...without, { ...saved, position: without.length }],
            };
          }
          return { ...v, chapters: without };
        }),
      }));
      showToast("Saved.");
    }
    setEditor(null);
    router.refresh();
  }

  async function deleteChapter(chapter: ChapterSummary) {
    await storiesBackend().deleteChapter(chapter.id);
    setStories((s) => ({
      ...s,
      volumes: s.volumes.map((v) => ({ ...v, chapters: v.chapters.filter((c) => c.id !== chapter.id) })),
    }));
    setEditor(null);
    showToast(`Deleted "${chapter.title}".`);
    router.refresh();
  }

  // ── volumes ─────────────────────────────────────────────────────────────

  async function saveVolume(draft: VolumeDraft, existing?: VolumeWithChapters) {
    const backend = storiesBackend();
    const input = {
      title: draft.title,
      subtitle: draft.subtitle,
      mood: draft.mood,
      dateLabel: draft.dateLabel,
      storyDate: draft.storyDate,
      body: textToBody(draft.body),
    };
    if (!existing) {
      const slug = uniqueSlug(draft.title, stories.volumes.map((v) => v.slug), "volume");
      const created = await backend.createVolume(stories.pet.id, input, stories.volumes.length, slug);
      setStories((s) => ({ ...s, volumes: [...s.volumes, { ...created, chapters: [] }] }));
      showToast("Volume added.");
    } else {
      const saved = await backend.updateVolume(existing.id, input);
      setStories((s) => ({
        ...s,
        volumes: s.volumes.map((v) => (v.id === existing.id ? { ...v, ...saved, chapters: v.chapters } : v)),
      }));
      showToast("Saved.");
    }
    setEditor(null);
    router.refresh();
  }

  async function deleteVolume(volume: VolumeWithChapters) {
    await storiesBackend().deleteVolume(volume.id);
    setStories((s) => ({ ...s, volumes: s.volumes.filter((v) => v.id !== volume.id) }));
    setEditor(null);
    showToast(`Deleted "${volume.title}".`);
    router.refresh();
  }

  function moveVolume(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= stories.volumes.length) return;
    const next = [...stories.volumes];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    const ids = next.map((v) => v.id);
    setStories((s) => ({ ...s, volumes: next.map((v, i) => ({ ...v, position: i })) }));
    storiesBackend()
      .reorderVolumes(stories.pet.id, ids)
      .then(() => router.refresh())
      .catch((e: Error) => resync(`The new order did not save. ${e.message}`));
  }

  const uploadTileImage = useCallback(
    (file: File) => storiesBackend().uploadImage(stories.pet.id, file, "tiles"),
    [stories.pet.id],
  );

  const volumeOptions = stories.volumes.map((v) => ({ id: v.id, title: v.title }));

  return (
    <>
      <Chrome />
      <main
        className="mx-auto w-full max-w-[1120px] px-4 pb-28 sm:px-6"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + 84px)" }}
        data-stories
        data-editing={editing ? "1" : undefined}
      >
        <header className="pr-14">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{stories.pet.name}</p>
          <h1 className="font-display mt-2 text-[44px] font-light leading-[1.02] tracking-[-0.01em] text-fg sm:text-[60px]">
            {stories.pet.name} Stories
          </h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted">
            Her life as a book. Each volume is a stretch of it; each chapter is a short scroll made from real photos.
            Start anywhere and keep scrolling: the chapters run on into each other.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {firstPublished ? (
              <Link
                href={`/stories/${firstPublished}`}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90"
                data-start-reading
              >
                Start from the beginning
                <Arrow />
              </Link>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                aria-pressed={editing}
                data-edit-toggle
                className={`inline-flex h-11 items-center gap-2 rounded-full border px-5 text-[15px] transition-colors ${
                  editing ? "border-accent bg-accent/15 text-accent" : "border-white/15 text-fg hover:border-white/35"
                }`}
              >
                {editing ? "Done editing" : "Edit"}
              </button>
            ) : null}
          </div>
          {editing ? (
            <p className="mt-4 max-w-[62ch] rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[14px] leading-relaxed text-fg/85">
              Drag a tile by its handle to reorder (or press and hold it on a phone). Tap a tile to change its face. Drafts
              are only visible to you.
            </p>
          ) : null}
        </header>

        <ol className="mt-12 flex flex-col gap-14" aria-label="Volumes">
          {stories.volumes.map((volume, index) => (
            <li key={volume.id}>
              <VolumeSection
                volume={volume}
                number={index + 1}
                editing={editing}
                canMoveUp={index > 0}
                canMoveDown={index < stories.volumes.length - 1}
                onMove={(d) => moveVolume(index, d)}
                onEditVolume={() => setEditor({ kind: "volume", mode: "edit", volume })}
                onAddChapter={() => router.push(`/stories/new?volume=${volume.slug}${demoSuffix("&")}`)}
                onEditChapter={(chapter) => setEditor({ kind: "chapter", mode: "edit", chapter })}
                onReorder={(ids) => reorderChapters(volume.id, ids)}
              />
            </li>
          ))}
        </ol>

        {editing ? (
          <button
            type="button"
            onClick={() => setEditor({ kind: "volume", mode: "create" })}
            data-add-volume
            className="mt-12 flex w-full items-center justify-center gap-2 rounded-[28px] border border-dashed border-white/20 py-8 text-[16px] text-muted transition-colors hover:border-white/40 hover:text-fg"
          >
            <Plus /> New volume
          </button>
        ) : null}

        <footer className="mx-auto mt-20 flex max-w-[640px] flex-col gap-3">
          <Link href="/" className={FOOT_LINK}>
            <span className="font-display text-xl font-light">Back to the story</span>
            <Arrow back />
          </Link>
          <Link href={SITE.nav.store.href} className={FOOT_LINK}>
            <span className="font-display text-xl font-light">{SITE.nav.store.label}</span>
            <Arrow />
          </Link>
          <p className="mt-6 text-center text-xs text-muted">{SITE.tagline}</p>
        </footer>
      </main>

      {editor?.kind === "chapter" ? (
        <TileEditor
          mode={editor.mode}
          slug={editor.mode === "edit" ? editor.chapter.slug : "new-chapter"}
          volumes={volumeOptions}
          initial={
            editor.mode === "edit"
              ? {
                  title: editor.chapter.title,
                  subtitle: editor.chapter.subtitle ?? "",
                  description: editor.chapter.description ?? "",
                  dateLabel: editor.chapter.dateLabel ?? "",
                  storyDate: editor.chapter.storyDate ?? "",
                  tileImageA: editor.chapter.tileImageA,
                  tileImageB: editor.chapter.tileImageB,
                  tileBlend: editor.chapter.tileBlend,
                  status: editor.chapter.status,
                  volumeId: editor.chapter.volumeId,
                }
              : emptyDraft(editor.volumeId)
          }
          onUpload={uploadTileImage}
          onSave={(draft) => saveChapter(draft, editor.mode === "edit" ? editor.chapter : undefined)}
          onDelete={editor.mode === "edit" ? () => deleteChapter(editor.chapter) : undefined}
          onClose={() => setEditor(null)}
          extra={
            editor.mode === "edit" ? (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
                <Link
                  href={`/stories/${editor.chapter.slug}/edit${demoSuffix("?")}`}
                  className="text-accent underline-offset-4 hover:underline"
                  data-edit-scenes
                >
                  Scenes, prompts and clips →
                </Link>
                <Link href={`/stories/${editor.chapter.slug}${demoSuffix("?")}`} className="text-fg/80 underline-offset-4 hover:underline">
                  Read it →
                </Link>
              </div>
            ) : null
          }
        />
      ) : null}

      {editor?.kind === "volume" ? (
        <VolumeEditor
          mode={editor.mode}
          chapterCount={editor.mode === "edit" ? editor.volume.chapters.length : 0}
          initial={
            editor.mode === "edit"
              ? {
                  title: editor.volume.title,
                  subtitle: editor.volume.subtitle ?? "",
                  dateLabel: editor.volume.dateLabel ?? "",
                  storyDate: editor.volume.storyDate ?? "",
                  mood: editor.volume.mood ?? "",
                  body: bodyToText(editor.volume.body),
                }
              : EMPTY_VOLUME
          }
          onSave={(draft) => saveVolume(draft, editor.mode === "edit" ? editor.volume : undefined)}
          onDelete={editor.mode === "edit" ? () => deleteVolume(editor.volume) : undefined}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </>
  );
}

/** Keep ?demo=1 on links while in forced demo mode (the harness uses it). */
function demoSuffix(joiner: "?" | "&"): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("demo") === "1" ? `${joiner}demo=1` : "";
}

const FOOT_LINK =
  "glass flex min-h-14 items-center justify-between gap-4 rounded-2xl px-5 text-fg transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// ── a volume ─────────────────────────────────────────────────────────────────

function VolumeSection({
  volume,
  number,
  editing,
  canMoveUp,
  canMoveDown,
  onMove,
  onEditVolume,
  onAddChapter,
  onEditChapter,
  onReorder,
}: {
  volume: VolumeWithChapters;
  number: number;
  editing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onEditVolume: () => void;
  onAddChapter: () => void;
  onEditChapter: (c: ChapterSummary) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = storyDateText(volume);
  const headingId = `volume-${volume.slug}`;
  const bodyId = `volume-body-${volume.slug}`;
  const items = useMemo(
    () => volume.chapters.map((c) => ({ ...c, label: c.title || "Untitled chapter" })),
    [volume.chapters],
  );

  return (
    <section aria-labelledby={headingId} data-volume={volume.slug}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-[62ch]">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
            <span className="text-accent">Volume {number}</span>
            {date ? <span> · {date}</span> : null}
            {volume.mood ? <span className="normal-case tracking-normal"> · {volume.mood}</span> : null}
          </p>
          <h2 id={headingId} className="font-display mt-2 text-[32px] font-light leading-[1.05] text-fg sm:text-[40px]">
            {volume.title}
          </h2>
          {volume.subtitle ? <p className="mt-3 text-[15px] leading-relaxed text-muted">{volume.subtitle}</p> : null}
          {volume.body.length ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 text-[14px] text-fg/80 underline-offset-4 hover:text-fg hover:underline"
            >
              {open ? "Close the story" : "Read the story"}
              <span aria-hidden className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}>⌄</span>
            </button>
          ) : null}
        </div>
        {editing ? (
          <div className="flex shrink-0 items-center gap-1" data-volume-tools>
            <IconButton label={`Move ${volume.title} up`} disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</IconButton>
            <IconButton label={`Move ${volume.title} down`} disabled={!canMoveDown} onClick={() => onMove(1)}>↓</IconButton>
            <IconButton label={`Edit ${volume.title}`} onClick={onEditVolume}>✎</IconButton>
          </div>
        ) : null}
      </div>

      {volume.body.length ? (
        <div
          id={bodyId}
          aria-hidden={!open}
          inert={!open}
          className={`grid transition-[grid-template-rows] duration-500 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className={`flex max-w-[62ch] flex-col gap-4 pt-5 transition-opacity duration-500 ${open ? "opacity-100" : "opacity-0"}`}>
              <div aria-hidden className="h-px w-10 bg-accent/70" />
              {volume.body.map((p, i) => (
                <p key={i} className="text-[17px] leading-[1.65] text-fg/90">{p}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {items.length || editing ? (
        <RippleGrid
          items={items}
          editable={editing}
          noun="chapter"
          onReorder={onReorder}
          className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
          renderItem={(chapter, state) => (
            <ChapterTile chapter={chapter} editing={editing} state={state} onEdit={() => onEditChapter(chapter)} />
          )}
          trailing={
            editing ? (
              <button
                type="button"
                onClick={onAddChapter}
                data-add-chapter={volume.slug}
                className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-white/20 text-[14px] text-muted transition-colors hover:border-white/40 hover:text-fg"
              >
                <Plus />
                New chapter
              </button>
            ) : null
          }
        />
      ) : null}
    </section>
  );
}

function ChapterTile({
  chapter,
  editing,
  state,
  onEdit,
}: {
  chapter: ChapterSummary;
  editing: boolean;
  state: TileRenderState;
  onEdit: () => void;
}) {
  const frame = `block aspect-[3/4] w-full overflow-hidden rounded-[22px] bg-[#141416] text-left ring-1 transition-[box-shadow] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
    state.dragging || state.lifted
      ? "shadow-[0_28px_60px_-18px_rgba(0,0,0,0.85)] ring-accent/70"
      : "shadow-[0_12px_32px_-16px_rgba(0,0,0,0.7)] ring-white/10"
  }`;

  if (!editing) {
    return (
      <Link href={`/stories/${chapter.slug}`} className={frame} data-chapter-tile={chapter.slug} draggable={false}>
        <TileFace data={chapter} />
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={`${frame} select-none [-webkit-touch-callout:none]`}
        data-chapter-tile={chapter.slug}
        aria-label={`Edit ${chapter.title}`}
        onClick={() => state.shouldHandleClick() && onEdit()}
        {...state.surface}
      >
        <TileFace data={chapter} cornerSpace />
      </button>
      <button
        type="button"
        {...state.grip}
        className="absolute right-2.5 top-2.5 z-10 flex h-10 w-10 cursor-grab items-center justify-center rounded-full border border-white/20 bg-black/45 text-fg backdrop-blur-md active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
          {[3, 9, 15].map((y) =>
            [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />),
          )}
        </svg>
      </button>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/12 text-[16px] text-fg/85 transition-colors hover:border-white/35 hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Plus() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0">
      <path
        d={back ? "M16 10H5M9 5l-5 5 5 5" : "M4 10h11M11 5l5 5-5 5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
