"use client";
/**
 * SwipeStory: the landing story, played by swipes rather than scrubbed by the
 * scroll (Felix, 22 Sep 2026). Chapter 1 plays under the hero as the page
 * loads; each swipe plays the flow to the next chapter, where the caption
 * assembles; press and hold pauses, dragging while holding scrubs.
 *
 * This component only lays out the stage once; SwipeEngine (engine.ts) finds
 * the parts by their data-el names and drives everything from its own
 * animation loop. See timeline.ts for the choreography and its timings.
 */
import { useEffect, useRef } from "react";
import { KITTENS, STORY, WHATSAPP } from "@/config/story";
import { SwipeEngine, type EngineEls } from "./engine";
import MissingFlyer from "./MissingFlyer";
import styles from "./swipe.module.css";

type EngineWindow = Window & { __swipeStory?: SwipeEngine };

function collect(root: HTMLElement): EngineEls {
  const one = <T extends Element>(name: string): T => {
    const el = root.querySelector<T>(`[data-el="${name}"]`);
    if (!el) throw new Error(`[story] missing ${name}`);
    return el;
  };
  const all = <T extends Element>(name: string): T[] => Array.from(root.querySelectorAll<T>(`[data-el="${name}"]`));
  return {
    stage: root,
    canvas: one<HTMLCanvasElement>("canvas"),
    bottom: one<HTMLElement>("bottom"),
    splash: one<HTMLElement>("splash"),
    splashBar: one<HTMLElement>("splash-bar"),
    skip: one<HTMLButtonElement>("skip"),
    live: one<HTMLElement>("live"),
    flight: one<HTMLElement>("flight"),
    chat: one<HTMLElement>("chat"),
    kittens: one<HTMLElement>("kittens"),
    cards: all<HTMLElement>("card"),
    kittenImages: all<HTMLImageElement>("kitten-img"),
    clock: one<HTMLElement>("clock"),
    hourHand: one<SVGElement>("hour"),
    minuteHand: one<SVGElement>("minute"),
    clockLabel: one<HTMLElement>("clock-label"),
    flyer: one<HTMLElement>("flyer"),
    rain: one<HTMLElement>("rain"),
    river: one<HTMLElement>("river"),
    shade: one<HTMLElement>("shade"),
    captionLayer: one<HTMLElement>("captions"),
    captions: all<HTMLElement>("caption").map((c) => ({
      root: c,
      kicker: c.querySelector<HTMLElement>("[data-part='kicker']")!,
      letters: Array.from(c.querySelectorAll<HTMLElement>("[data-part='ch']")),
      subtitle: c.querySelector<HTMLElement>("[data-part='subtitle']")!,
    })),
    rail: one<HTMLElement>("rail"),
    railFill: one<HTMLElement>("rail-fill"),
    railDots: all<HTMLElement>("rail-dot"),
  };
}

/** A title split into words (which wrap) of letters (which fly in). */
function Letters({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, w) => (
        <span key={w}>
          <span className={styles.word}>
            {Array.from(word).map((ch, i) => (
              <span key={i} className={styles.ch} data-part="ch">
                {ch}
              </span>
            ))}
          </span>
          {w < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

export default function SwipeStory() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const engine = new SwipeEngine(collect(root), STORY);
    engine.start();
    (window as EngineWindow).__swipeStory = engine;
    return () => {
      engine.destroy();
      const w = window as EngineWindow;
      if (w.__swipeStory === engine) delete w.__swipeStory;
    };
  }, []);

  return (
    <section
      ref={rootRef}
      className={styles.stage}
      data-swipe-story
      data-mode="intro"
      data-splash="false"
      data-hint="false"
      data-holding="false"
      aria-roledescription="story"
      aria-label="Kitty's story in four chapters"
    >
      <canvas className={styles.canvas} data-el="canvas" aria-hidden />
      <div className={`${styles.layer} ${styles.river}`} data-el="river" aria-hidden />
      <div className={`${styles.layer} ${styles.rain}`} data-el="rain" aria-hidden />

      <div className={`${styles.layer} ${styles.flight}`} data-el="flight" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.chat}
          data-el="chat"
          src={WHATSAPP.src}
          width={WHATSAPP.width}
          height={WHATSAPP.height}
          alt=""
          decoding="async"
          draggable={false}
        />
      </div>

      <div className={styles.layer} aria-hidden>
        <div className={styles.flyer} data-el="flyer">
          <MissingFlyer />
        </div>
      </div>

      <div className={`${styles.layer} ${styles.kittens}`} data-el="kittens" aria-hidden>
        {KITTENS.map((k, i) => (
          <div key={k.src} className={styles.card} data-el="card" style={{ zIndex: i + 1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img data-el="kitten-img" data-src={k.src} alt="" decoding="async" draggable={false} />
            <span className="font-display">{k.time}</span>
          </div>
        ))}
        <div className={styles.clock} data-el="clock">
          <div className={styles.clockInner}>
            <svg viewBox="0 0 64 64" width="52" height="52" aria-hidden>
              <circle cx="32" cy="32" r="29" fill="rgba(11,11,12,0.55)" stroke="rgba(244,241,234,0.85)" strokeWidth="2" />
              {Array.from({ length: 12 }, (_, i) => (
                <line
                  key={i}
                  x1="32"
                  y1="6.5"
                  x2="32"
                  y2={i % 3 === 0 ? 11 : 9}
                  stroke="rgba(244,241,234,0.7)"
                  strokeWidth={i % 3 === 0 ? 2 : 1.2}
                  transform={`rotate(${i * 30} 32 32)`}
                />
              ))}
              <line data-el="hour" x1="32" y1="32" x2="32" y2="18" stroke="#f4f1ea" strokeWidth="3" strokeLinecap="round" />
              <line data-el="minute" x1="32" y1="32" x2="32" y2="10" stroke="#ffd166" strokeWidth="2" strokeLinecap="round" />
              <circle cx="32" cy="32" r="2.4" fill="#f4f1ea" />
            </svg>
            <span className={styles.clockLabel} data-el="clock-label">
              12:30am
            </span>
          </div>
        </div>
      </div>

      <div className={styles.shade} data-el="shade" aria-hidden />

      <div className={styles.bottom} data-el="bottom">
        <div className={styles.captions} data-el="captions" aria-hidden>
          {STORY.map((c) => (
            <div key={c.id} className={styles.caption} data-el="caption">
              <p className={styles.kicker} data-part="kicker">
                {c.kicker}
              </p>
              <h2 className={`${styles.title} font-display`}>
                <Letters text={c.title} />
              </h2>
              <p className={styles.subtitle} data-part="subtitle">
                {c.subtitle}
              </p>
            </div>
          ))}
        </div>
        <p className={styles.hint} aria-hidden>
          <span className={styles.chevron} />
          <span className={styles.hintTouch}>Swipe up</span>
          <span className={styles.hintFine}>Scroll or press ↓</span>
        </p>
      </div>

      <div className={styles.rail} data-el="rail" aria-hidden>
        <span className={styles.railLine} />
        <span className={styles.railFill} data-el="rail-fill" />
        {STORY.map((c) => (
          <span key={c.id} className={styles.dot} data-el="rail-dot" />
        ))}
      </div>

      <p className={styles.paused} aria-hidden>
        Paused · drag to scrub
      </p>

      <button type="button" className={`glass ${styles.skip}`} data-el="skip">
        Skip story
      </button>

      <div className={styles.splash} data-el="splash" aria-hidden>
        <p className="font-display">Kittyfive</p>
        <div className={styles.bar}>
          <div className={styles.barFill} data-el="splash-bar" />
        </div>
      </div>

      <p className="sr-only" aria-live="polite" data-el="live" />
      <div className="sr-only">
        <p>Kitty&apos;s story in four chapters. Swipe up, scroll, or press the down arrow for the next chapter; press and hold to pause.</p>
        <ol>
          {STORY.map((c) => (
            <li key={c.id}>
              {c.title}. {c.subtitle}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
