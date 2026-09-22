"use client";
/**
 * Story — the scroll story: every scene from src/config/story.ts in order,
 * each wired to its neighbours so transitions know which pair they belong to.
 *
 * - /story/index.json (written by scripts/build-story.mjs) says which scenes
 *   have frames. It is fetched once, 404-safe: present → "present", listed
 *   file but scene missing → "absent" (no manifest request at all), no index
 *   → "probe" (each scene asks for its own manifest). Until it answers every
 *   scene is "pending" and loads nothing.
 * - `current` is the index of the scene whose main window is active. It is
 *   the only scroll-derived React state and changes once per scene; scenes
 *   use it to decide whether they are within one of the current one (frames
 *   resident) and how urgently to fetch.
 * - The rail on the right edge shows 11 dots, the current one filled. It is
 *   vertically centred so it never touches the 44px menu button top-right,
 *   fades in while the story is on screen and ignores the pointer.
 * - Each scene sits in its own error boundary: a scene that throws collapses
 *   to a plain text card instead of taking the page down.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { STORY, type StoryScene as SceneDef } from "@/config/story";
import StoryScene from "./StoryScene";
import type { MediaHint } from "./useFrameSequence";
import styles from "./story.module.css";

const INDEX_URL = "/story/index.json";

type Hints = Record<string, MediaHint>;

function hintsFrom(json: unknown): Hints {
  const listed = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const out: Hints = {};
  for (const scene of STORY) {
    out[scene.id] = listed ? (scene.id in listed ? "present" : "absent") : "probe";
  }
  return out;
}

class SceneBoundary extends Component<{ scene: SceneDef; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[story] scene failed to render", this.props.scene.id, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { scene } = this.props;
    return (
      <section className={styles.fallback} data-scene={scene.id} aria-label={scene.title}>
        {scene.kicker ? <p className={styles.kicker} style={{ opacity: 1 }}>{scene.kicker}</p> : null}
        <h2 className={`${styles.title} font-display`} style={{ opacity: 1 }}>
          {scene.title}
        </h2>
        {scene.beats.map((beat, k) => (
          <p key={k} className={styles.beat} style={{ opacity: 1, marginBottom: 10 }}>
            {beat}
          </p>
        ))}
      </section>
    );
  }
}

export default function Story() {
  const [hints, setHints] = useState<Hints | null>(null);
  const [current, setCurrent] = useState(0);
  const [railOn, setRailOn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Which scenes have media, from the build's index. Any failure → probe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ctrl = new AbortController();
    fetch(INDEX_URL, { signal: ctrl.signal, cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) return null;
        try {
          return (await res.json()) as unknown;
        } catch {
          return null;
        }
      })
      .then((json) => {
        if (!ctrl.signal.aborted) setHints(hintsFrom(json));
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setHints(hintsFrom(null));
      });
    return () => ctrl.abort();
  }, []);

  // Rail visibility: on while any part of the story is in the middle band.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    try {
      gsap.registerPlugin(ScrollTrigger);
    } catch {
      return;
    }
    const st = ScrollTrigger.create({
      trigger: root,
      start: "top 70%",
      end: "bottom 30%",
      onToggle: (self) => setRailOn(self.isActive),
    });
    setRailOn(st.isActive);
    return () => st.kill();
  }, []);

  const onCurrent = useCallback((i: number) => setCurrent(i), []);

  const scenes = useMemo(
    () =>
      STORY.map((scene, i) => ({
        scene,
        prev: i > 0 ? STORY[i - 1] : null,
        next: i < STORY.length - 1 ? STORY[i + 1] : null,
      })),
    [],
  );

  return (
    <div ref={rootRef} className="relative" data-story>
      {scenes.map(({ scene, prev, next }, i) => (
        <SceneBoundary key={scene.id} scene={scene}>
          <StoryScene
            scene={scene}
            index={i}
            prev={prev}
            next={next}
            hint={hints ? (hints[scene.id] ?? "probe") : "pending"}
            current={current}
            onCurrent={onCurrent}
          />
        </SceneBoundary>
      ))}

      <div className={`${styles.rail} ${railOn ? styles.railOn : ""}`} aria-hidden data-story-rail>
        {STORY.map((scene, i) => (
          <span key={scene.id} className={`${styles.dot} ${i === current ? styles.dotOn : ""}`} />
        ))}
      </div>
    </div>
  );
}
