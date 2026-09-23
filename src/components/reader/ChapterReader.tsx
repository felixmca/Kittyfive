"use client";
/**
 * The chapter reader: one long scroll through the whole book.
 *
 * Every chapter has its own URL, but the page never ends at a chapter's edge.
 * Scroll past the end of a chapter and the next one is already there; past
 * the last chapter of a volume and you are in the next volume. Scroll up from
 * the first chapter of volume 2 and you arrive at the last chapter of volume
 * 1, at its end. The address bar and the tab title follow whichever chapter
 * is in the middle of the screen, so a shared link opens where you were.
 *
 * How: `range` is the slice of the reading order that is rendered. Chapters
 * are fetched a step ahead in both directions. Appending below needs nothing
 * special; prepending above would shove the page down, so the first rendered
 * block's position is measured before and after and the scroll is corrected
 * in a layout effect, before paint. Browser scroll anchoring is switched off
 * while the reader is mounted so it cannot correct the same shift twice.
 *
 * Scenes get their scroll progress from one rAF-throttled scroll listener
 * here (see ReaderScene); nothing re-renders per frame.
 */
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Chrome from "@/components/chrome/Chrome";
import { CHROME_TOP, CLEAR_OF_HOME } from "@/components/chrome/layout";
import SubscribeCard from "@/components/stories/SubscribeCard";
import TileFace from "@/components/stories/TileFace";
import ReaderScene, { type SceneRegistry } from "./ReaderScene";
import { SITE } from "@/config/site";
import { storiesBackend } from "@/lib/stories/client";
import type { Chapter, Pet, ReadingEntry } from "@/lib/stories/types";

interface Props {
  pet: Pet;
  reading: ReadingEntry[];
  startIndex: number;
  initialChapters: Record<string, Chapter>;
}

const NEAR = 1.4; // viewports from an edge at which the next chapter is attached

export default function ChapterReader({ pet, reading, startIndex, initialChapters }: Props) {
  const [range, setRange] = useState({ start: startIndex, end: startIndex });
  const [chapters, setChapters] = useState<Record<string, Chapter>>(initialChapters);
  const [current, setCurrent] = useState(startIndex);
  const loading = useRef(new Set<string>());
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const scenes = useRef(new Map<HTMLElement, (p: number) => void>());
  const ticking = useRef(false);

  const chaptersRef = useRef(chapters);
  const rangeRef = useRef(range);
  useLayoutEffect(() => {
    chaptersRef.current = chapters;
    rangeRef.current = range;
  }, [chapters, range]);

  // ── scenes' scroll progress ─────────────────────────────────────────────

  const updateScenes = useCallback(() => {
    const vh = window.innerHeight;
    for (const [el, update] of scenes.current) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const span = Math.max(1, r.height - vh);
      update(Math.min(1, Math.max(0, -r.top / span)));
    }
  }, []);

  const registry = useMemo<SceneRegistry>(
    () => ({
      register(el, update) {
        scenes.current.set(el, update);
        requestAnimationFrame(updateScenes);
        return () => {
          scenes.current.delete(el);
        };
      },
    }),
    [updateScenes],
  );

  // ── fetching neighbours ─────────────────────────────────────────────────

  const ensure = useCallback(
    async (index: number) => {
      const entry = reading[index];
      if (!entry || chaptersRef.current[entry.chapterId] || loading.current.has(entry.chapterId)) return;
      loading.current.add(entry.chapterId);
      try {
        const chapter = await storiesBackend().loadChapter(pet.slug, entry.chapterId);
        if (chapter) setChapters((c) => ({ ...c, [chapter.id]: chapter }));
      } catch (e) {
        console.warn("[reader] could not load chapter", entry.slug, e);
      } finally {
        loading.current.delete(entry.chapterId);
      }
    },
    [pet.slug, reading],
  );

  const tryExtend = useCallback(() => {
    const { start, end } = rangeRef.current;
    const vh = window.innerHeight;
    const y = window.scrollY;
    const docH = document.documentElement.scrollHeight;

    if (end < reading.length - 1 && y + vh > docH - NEAR * vh) {
      const next = reading[end + 1];
      if (chaptersRef.current[next.chapterId]) setRange((r) => (r.end === end ? { ...r, end: end + 1 } : r));
      else void ensure(end + 1);
    }
    if (start > 0 && y < NEAR * vh && !anchor.current) {
      const prev = reading[start - 1];
      if (chaptersRef.current[prev.chapterId]) {
        const first = document.querySelector<HTMLElement>(`[data-chapter-block="${reading[start].chapterId}"]`);
        if (first) anchor.current = { id: reading[start].chapterId, top: first.getBoundingClientRect().top };
        setRange((r) => (r.start === start ? { ...r, start: start - 1 } : r));
      } else {
        void ensure(start - 1);
      }
    }
  }, [ensure, reading]);

  // After a chapter is prepended, put the reader back exactly where they were.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = document.querySelector<HTMLElement>(`[data-chapter-block="${a.id}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - a.top;
    if (delta) window.scrollBy(0, delta);
  }, [range.start]);

  // A newly fetched neighbour may be exactly what the edge was waiting for.
  useEffect(() => {
    tryExtend();
  }, [chapters, tryExtend]);

  // Keep the neighbours of the current chapter loaded before they are needed.
  useEffect(() => {
    void ensure(current + 1);
    void ensure(current - 1);
  }, [current, ensure]);

  // ── scroll ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const html = document.documentElement;
    const prevAnchor = html.style.getPropertyValue("overflow-anchor");
    html.style.setProperty("overflow-anchor", "none");
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        updateScenes();
        tryExtend();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (prevAnchor) html.style.setProperty("overflow-anchor", prevAnchor);
      else html.style.removeProperty("overflow-anchor");
    };
  }, [tryExtend, updateScenes]);

  // The chapter across the middle of the screen owns the URL and the title.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.chapterBlock;
          const index = reading.findIndex((r) => r.chapterId === id);
          if (index >= 0) setCurrent(index);
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    document.querySelectorAll("[data-chapter-block]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [range, reading]);

  useEffect(() => {
    const entry = reading[current];
    if (!entry) return;
    const url = `/stories/${entry.slug}${window.location.search}`;
    if (window.location.pathname !== `/stories/${entry.slug}`) {
      window.history.replaceState(window.history.state, "", url);
    }
    document.title = `${entry.title} · ${SITE.name}`;
  }, [current, reading]);

  const blocks: number[] = [];
  for (let i = range.start; i <= range.end; i++) blocks.push(i);
  const entry = reading[current];

  return (
    <>
      <Chrome />
      {entry ? (
        <nav
          aria-label="Where you are in the book"
          // In the chrome row, beside Kitty's home button and clear of the menu.
          className="pointer-events-none fixed z-[40] flex h-11 items-center"
          style={{ top: CHROME_TOP, left: CLEAR_OF_HOME, maxWidth: "calc(100vw - 132px)" }}
          data-reader-position
        >
          {/* Where you are, and the way back to the whole book at this volume. */}
          <Link
            href={`/stories#volume-${entry.volumeSlug}`}
            aria-label={`Volume ${entry.volumeNumber}, ${entry.volumeTitle}: back to all the volumes`}
            className="pointer-events-auto flex min-h-9 min-w-0 items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-fg/85 backdrop-blur-md transition-colors hover:border-white/35 hover:text-fg"
          >
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="shrink-0 opacity-80">
              <path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{`Vol ${entry.volumeNumber} · ${entry.volumeTitle}`}</span>
          </Link>
        </nav>
      ) : null}
      <main data-reader>
        {range.start === 0 ? null : <div className="h-px" aria-hidden />}
        {blocks.map((i) => {
          const r = reading[i];
          const chapter = chapters[r.chapterId];
          if (!chapter) return null;
          return <ChapterBlock key={r.chapterId} entry={r} chapter={chapter} registry={registry} />;
        })}
        {range.end === reading.length - 1 ? <TheEnd petName={pet.name} petId={pet.id} /> : <Loading />}
      </main>
    </>
  );
}

function ChapterBlock({ entry, chapter, registry }: { entry: ReadingEntry; chapter: Chapter; registry: SceneRegistry }) {
  return (
    <article data-chapter-block={chapter.id} data-chapter-slug={chapter.slug} aria-label={chapter.title}>
      <section className="relative h-[100dvh] min-h-[560px] overflow-hidden" data-chapter-cover>
        <TileFace
          data={chapter}
          size="cover"
          eager
          kicker={`Volume ${entry.volumeNumber} · ${entry.volumeTitle}`}
        >
          <p className="mt-8 flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-white/45">
            <span aria-hidden className="inline-block h-6 w-px animate-pulse bg-white/40" />
            {`Chapter ${entry.chapterNumber}`}
          </p>
        </TileFace>
      </section>
      {chapter.scenes.length ? (
        chapter.scenes.map((scene) => (
          <ReaderScene key={scene.id} scene={scene} registry={registry} seed={chapter.slug} />
        ))
      ) : (
        <section className="flex min-h-[60dvh] items-center justify-center px-6">
          <p className="max-w-[36ch] text-center text-[16px] text-muted">This chapter is still being written.</p>
        </section>
      )}
      <CameraRoll dir={chapter.scenes.find((s) => s.frames?.dir.startsWith("/"))?.frames?.dir ?? null} />
    </article>
  );
}

interface Extra {
  src: string;
  width: number;
  height: number;
}

/**
 * The real photos from the same moment, under the AI clip: the chapter's
 * extras, which npm run story lists in <dir>/media.json (landing chapters).
 */
function CameraRoll({ dir }: { dir: string | null }) {
  const [extras, setExtras] = useState<Extra[]>([]);
  useEffect(() => {
    if (!dir) return;
    const ctrl = new AbortController();
    fetch(`${dir.replace(/\/$/, "")}/media.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { extras?: Extra[] } | null) => {
        if (j?.extras?.length) setExtras(j.extras);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [dir]);
  if (!extras.length) return null;
  return (
    <section className="py-12" aria-label="From the camera roll" data-camera-roll>
      <p className="mx-auto mb-4 max-w-[720px] px-6 text-[11px] font-medium uppercase tracking-[0.2em] text-muted sm:px-8">
        From the camera roll
      </p>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:px-8">
        {extras.map((e) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={e.src}
            src={e.src}
            alt=""
            loading="lazy"
            decoding="async"
            width={e.width}
            height={e.height}
            className="h-[46dvh] max-h-[420px] w-auto shrink-0 snap-center rounded-2xl object-cover ring-1 ring-white/10"
          />
        ))}
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="flex h-[60dvh] items-center justify-center" aria-hidden>
      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white/40" />
    </div>
  );
}

function TheEnd({ petName, petId }: { petName: string; petId: string }) {
  return (
    <section className="flex min-h-[80dvh] flex-col items-center justify-center gap-6 px-6 text-center" data-reader-end>
      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">The end, for now</p>
      <h2 className="font-display max-w-[18ch] text-[40px] font-light leading-[1.05] text-fg sm:text-[52px]">
        {`${petName} is still writing the next one.`}
      </h2>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/stories" className="inline-flex h-11 items-center rounded-full border border-white/15 px-5 text-[15px] text-fg hover:border-white/35">
          All the volumes
        </Link>
        <Link href={SITE.nav.store.href} className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-[#141414] hover:opacity-90">
          {SITE.nav.store.label}
        </Link>
      </div>
      <Link href="/" className="text-[14px] text-muted underline-offset-4 hover:text-fg hover:underline">
        Back to the start of {petName}&apos;s story
      </Link>
      <SubscribeCard petId={petId} petName={petName} className="mt-6 w-full max-w-[520px] text-left" />
    </section>
  );
}
