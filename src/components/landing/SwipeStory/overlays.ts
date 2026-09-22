/**
 * The DOM choreography over the canvas: the WhatsApp flight, the kitten
 * polaroids and their clock, the MISSING flyer, the stand-in moods, the
 * captions and the progress rail. Every function takes the playhead and the
 * layout and writes styles; nothing is remembered between calls, so any t
 * (forwards, backwards, scrubbed) draws the same way.
 */
import { WHATSAPP } from "@/config/story";
import { clamp, clamp01, easeOutCubic, hashString, lerp, smoothstep, span as between } from "@/components/story/motion";
import type { Rect, StageLayout } from "./painter";
import {
  CAPTION,
  FLIGHT,
  captionStates,
  flightProgress,
  kittenTimes,
  moodAt,
  spanIndexAt,
  type Timeline,
} from "./timeline";

export interface CaptionEls {
  root: HTMLElement;
  kicker: HTMLElement;
  letters: HTMLElement[];
  subtitle: HTMLElement;
}

export interface OverlayEls {
  flight: HTMLElement;
  chat: HTMLElement;
  kittens: HTMLElement;
  cards: HTMLElement[];
  clock: HTMLElement;
  hourHand: SVGElement;
  minuteHand: SVGElement;
  clockLabel: HTMLElement;
  flyer: HTMLElement;
  rain: HTMLElement;
  river: HTMLElement;
  shade: HTMLElement;
  captionLayer: HTMLElement;
  captions: CaptionEls[];
  rail: HTMLElement;
  railFill: HTMLElement;
  railDots: HTMLElement[];
}

// ─── easing ──────────────────────────────────────────────────────────────────

const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const easeInCubic = (t: number) => {
  const x = clamp01(t);
  return x * x * x;
};
/** Overshoots a touch and settles: type locking into place. */
const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
/** Deterministic 0..1 values from a key (letter scatter, drop angles). */
function rand(key: string, n: number): number {
  return ((hashString(`${key}#${n}`) >>> 8) & 0xffff) / 0xffff;
}

function setVisible(el: HTMLElement, on: boolean): void {
  const v = on ? "visible" : "hidden";
  if (el.style.visibility !== v) el.style.visibility = v;
}

// ─── the WhatsApp flight (chapter 1 → 2) ─────────────────────────────────────

interface Pose {
  /** Where the photo's centre sits on the stage. */
  cx: number;
  cy: number;
  /** Stage px per screenshot px. */
  s: number;
}

const lerpPose = (a: Pose, b: Pose, e: number): Pose => ({
  cx: lerp(a.cx, b.cx, e),
  cy: lerp(a.cy, b.cy, e),
  s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), e)),
});

interface FlightFrame {
  pose: Pose;
  z: number;
  rot: number;
  tiltX: number;
  blur: number;
  opacity: number;
  /** How tightly the chat is clipped to the picture (wide screens), 0..1. */
  clip: number;
  /** Where chapter 1's final frame is drawn meanwhile (it lives inside the chat's photo). */
  inset: Rect;
}

const lerpRect = (a: Rect, b: Rect, e: number): Rect => ({
  x: lerp(a.x, b.x, e),
  y: lerp(a.y, b.y, e),
  w: lerp(a.w, b.w, e),
  h: lerp(a.h, b.h, e),
});

/**
 * The flight at progress u, for a layout:
 *   1 · airdrop: the chat comes in from behind the viewer (huge, tilted,
 *       blurred, in front of the screen) and settles phone-sized, while the
 *       frame shrinks into the chat's photo, so the chat ends up framing it;
 *   2 · hold: the chat is read for a beat ("Anyone missing this cutie?");
 *   3 · zoom: the camera pushes into the photo until it is the full-screen
 *       frame again, and chapter 2 takes over.
 */
function flightFrame(u: number, L: StageLayout): FlightFrame {
  const P = WHATSAPP.photo;
  const photoCx = P.x + P.w / 2;
  const photoCy = P.y + P.h / 2;
  const land = WHATSAPP.landsOn;

  // Full size: the chat's photo covers chapter 1's final frame exactly.
  const k = L.pic.w / 576;
  const fill: Pose = {
    cx: L.pic.x + (land.x + land.w / 2) * k,
    cy: L.pic.y + (land.y + land.h / 2) * k,
    s: (land.w * k) / P.w,
  };
  // Phone-sized: the whole chat on screen, centred.
  const sp = Math.min((0.84 * L.view.h) / WHATSAPP.height, (0.86 * L.view.w) / WHATSAPP.width);
  const phone: Pose = {
    cx: L.view.x + L.view.w / 2 + (photoCx - WHATSAPP.width / 2) * sp,
    cy: L.view.y + L.view.h / 2 + (photoCy - WHATSAPP.height / 2) * sp,
    s: sp,
  };
  const behind: Pose = { cx: phone.cx + 0.32 * L.view.w, cy: phone.cy + 0.55 * L.view.h, s: sp * 3.2 };

  const photoRect = (p: Pose): Rect => ({ x: p.cx - (P.w / 2) * p.s, y: p.cy - (P.h / 2) * p.s, w: P.w * p.s, h: P.h * p.s });
  // The frame is a crop of the photo (WHATSAPP.landsOn), so it sits inside it like this.
  const frameIn = (r: Rect): Rect => ({
    x: r.x - (land.x / land.w) * r.w,
    y: r.y - (land.y / land.h) * r.h,
    w: (576 / land.w) * r.w,
    h: (1024 / land.h) * r.h,
  });

  if (u < FLIGHT.airdrop) {
    const p = u / FLIGHT.airdrop;
    const e = easeOutCubic(p);
    return {
      pose: lerpPose(behind, phone, e),
      z: 700 * (1 - e),
      rot: -16 * (1 - e) - 2.2 * e,
      tiltX: 26 * (1 - e),
      blur: 18 * (1 - e) * (1 - e),
      opacity: smoothstep(p * 2),
      clip: 0,
      inset: lerpRect(L.pic, frameIn(photoRect(phone)), easeInOutCubic(between(p, 0.1, 1))),
    };
  }
  if (u < FLIGHT.hold) {
    const p = between(u, FLIGHT.airdrop, FLIGHT.hold);
    const pose = { ...phone, s: phone.s * (1 + 0.025 * p) };
    return { pose, z: 0, rot: -2.2 + 1.2 * p, tiltX: 0, blur: 0, opacity: 1, clip: 0, inset: frameIn(photoRect(pose)) };
  }
  const p = between(u, FLIGHT.hold, 1);
  const e = easeInOutCubic(p);
  const pose = lerpPose({ ...phone, s: phone.s * 1.025 }, fill, e);
  return {
    pose,
    z: 0,
    rot: -1 * (1 - e),
    tiltX: 0,
    blur: 0,
    opacity: 1 - smoothstep(between(p, 0.9, 1)),
    clip: smoothstep(between(p, 0.45, 1)),
    inset: frameIn(photoRect(pose)),
  };
}

/** Where the canvas draws the frame during the flight (null: not flying). */
export function flightInset(tl: Timeline, t: number, L: StageLayout): Rect | null {
  const f = flightProgress(tl, t);
  return f ? flightFrame(f.u, L).inset : null;
}

export function renderFlight(els: OverlayEls, tl: Timeline, t: number, L: StageLayout): void {
  const f = flightProgress(tl, t);
  setVisible(els.flight, Boolean(f));
  if (!f) return;
  const P = WHATSAPP.photo;
  const fr = flightFrame(f.u, L);
  els.chat.style.transform =
    `translate3d(${fr.pose.cx}px, ${fr.pose.cy}px, ${fr.z}px) rotateX(${fr.tiltX}deg) rotate(${fr.rot}deg) ` +
    `scale(${fr.pose.s}) translate(${-(P.x + P.w / 2)}px, ${-(P.y + P.h / 2)}px)`;
  els.chat.style.opacity = String(fr.opacity);
  els.chat.style.filter = fr.blur > 0.3 ? `blur(${fr.blur.toFixed(1)}px)` : "none";

  if (L.wide && fr.clip > 0.001) {
    const top = L.pic.y * fr.clip;
    const left = L.pic.x * fr.clip;
    const right = (L.W - L.pic.x - L.pic.w) * fr.clip;
    const bottom = (L.H - L.pic.y - L.pic.h) * fr.clip;
    els.flight.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  } else if (els.flight.style.clipPath) {
    els.flight.style.clipPath = "";
  }
}

// ─── the kittens (chapter 2) ─────────────────────────────────────────────────

/** A loose fanned stack: offsets in units of `spread`, and a resting tilt. */
const FAN = [
  { dx: -1.3, dy: -0.12, rot: -12 },
  { dx: -0.5, dy: 0.14, rot: -4 },
  { dx: 0.35, dy: -0.08, rot: 5 },
  { dx: 1.2, dy: 0.16, rot: 12 },
  { dx: -0.05, dy: 0.5, rot: -3 },
];

function clockLabel(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60) % 12;
  const mm = String(m % 60).padStart(2, "0");
  return `${h === 0 ? 12 : h}:${mm}am`;
}

export function renderKittens(els: OverlayEls, tl: Timeline, t: number, L: StageLayout): void {
  const s = tl.reduced ? null : tl.spans.find((x) => x.chapter.overlay === "kittens" && x.clip);
  const on = Boolean(s) && t >= s!.clipStart - 0.1 && t <= s!.stop + 0.3;
  setVisible(els.kittens, on);
  if (!s || !on) {
    // A child that says visibility:visible would still show through a hidden parent.
    els.cards.forEach((card) => setVisible(card, false));
    setVisible(els.clock, false);
    return;
  }
  const { land, leave, dawn } = kittenTimes(s);

  // Where the stack rests: low in the frame on phones, in the side panel when wide.
  const panel = L.wide ? L.view.x + L.view.w - (L.pic.x + L.pic.w) : 0;
  const wideFan = L.wide && panel > 220;
  const cardW = wideFan ? clamp(panel * 0.4, 130, 210) : clamp(L.view.w * 0.37, 112, 176);
  const cardH = cardW * 1.18;
  const spread = wideFan ? Math.min(panel * 0.2, cardW * 0.62) : L.view.w * 0.19;
  const ax = wideFan ? L.pic.x + L.pic.w + panel * 0.46 : L.view.x + L.view.w * 0.5;
  const ay = wideFan ? L.view.y + L.view.h * 0.5 : L.view.y + L.view.h * 0.68;

  els.cards.forEach((card, j) => {
    const fan = FAN[j];
    const x = ax + fan.dx * spread;
    const y = ay + fan.dy * spread;
    const dropStart = land[j] - 0.55;
    if (t < dropStart || t > leave[j] + 0.7) {
      setVisible(card, false);
      return;
    }
    setVisible(card, true);
    const key = `kitten${j}`;
    let cx = x;
    let cy = y;
    let rot = fan.rot;
    let scale = 1;
    let opacity = 1;

    if (t < land[j]) {
      // Dropped in from above the viewer, falling with a little gravity.
      const p = between(t, dropStart, land[j]);
      const sx = x + (rand(key, 1) - 0.5) * 0.35 * L.view.w;
      const sy = L.view.y - cardH * 0.9 - 40;
      cx = lerp(sx, x, easeOutCubic(p));
      cy = lerp(sy, y, p * p);
      rot = lerp(fan.rot + (rand(key, 2) - 0.5) * 60, fan.rot, easeOutCubic(p));
      scale = lerp(1.45, 1, p * p);
      opacity = smoothstep(p * 2.5);
    } else {
      // Landed: a small bounce and wobble that dies away, like the tiles' springs.
      const tau = t - land[j];
      cy -= 9 * Math.exp(-7 * tau) * Math.abs(Math.sin(17 * tau));
      rot += 5 * Math.exp(-6 * tau) * Math.sin(15 * tau + 0.5);
      scale = 1 + 0.035 * Math.exp(-9 * tau) * Math.cos(22 * tau);
    }

    // Adopted: lifted away to the nearest edge, one by one.
    const q = between(t, leave[j], leave[j] + 0.65);
    if (q > 0) {
      const side = fan.dx < -0.2 ? -1 : fan.dx > 0.2 ? 1 : rand(key, 3) > 0.5 ? 1 : -1;
      const e = easeInCubic(q);
      cx += side * 0.8 * L.view.w * e;
      cy -= (0.22 + 0.05 * j) * L.view.h * e;
      rot += side * 32 * q;
      scale *= 1 - 0.15 * q;
      opacity *= 1 - smoothstep(between(q, 0.5, 1));
    }

    const width = `${cardW}px`;
    if (card.style.width !== width) {
      // Sized from the card (percent padding would follow the whole stage's width).
      const pad = Math.round(cardW * 0.06);
      card.style.width = width;
      card.style.padding = `${pad}px ${pad}px 0`;
      card.style.fontSize = `${Math.round(cardW * 0.1)}px`;
    }
    card.style.transform = `translate3d(${cx - cardW / 2}px, ${cy - cardH / 2}px, 0) rotate(${rot}deg) scale(${scale})`;
    card.style.opacity = String(opacity);
  });

  // The clock: 12:30 → 2:30, one kitten every thirty minutes, then on to dawn.
  const clockIn = smoothstep(between(t, s.clipStart + 0.15, s.clipStart + 0.5));
  const clockOut = 1 - smoothstep(between(t, s.clipEnd, s.clipEnd + 0.4));
  const clockOn = Math.min(clockIn, clockOut);
  setVisible(els.clock, clockOn > 0.001);
  if (clockOn > 0.001) {
    let minutes: number;
    if (t <= land[0]) minutes = lerp(20, 30, between(t, s.clipStart + 0.15, land[0]));
    else if (t <= land[4]) minutes = 30 + 120 * between(t, land[0], land[4]);
    else minutes = lerp(150, 364, easeInOutCubic(between(t, land[4] + 0.15, dawn)));
    els.clock.style.opacity = String(clockOn);
    els.clock.style.transform = `translate3d(${L.view.x + L.view.w / 2}px, ${L.view.y}px, 0)`;
    els.minuteHand.setAttribute("transform", `rotate(${(minutes % 60) * 6} 32 32)`);
    els.hourHand.setAttribute("transform", `rotate(${((minutes / 60) % 12) * 30} 32 32)`);
    const label = minutes >= 300 ? `${clockLabel(minutes)} · dawn` : clockLabel(minutes);
    if (els.clockLabel.textContent !== label) els.clockLabel.textContent = label;
  }
}

// ─── the MISSING flyer (into chapter 3) ──────────────────────────────────────

export function renderFlyer(els: OverlayEls, tl: Timeline, t: number, L: StageLayout): void {
  // By the chapter's own entrance: reduced motion turns every entrance into a crossfade.
  const i = tl.spans.findIndex((x) => x.chapter.enter === "flyer");
  const s = i >= 0 ? tl.spans[i] : null;
  const next = s ? tl.spans[i + 1] : undefined;
  if (!s || t < s.enterStart) {
    setVisible(els.flyer, false);
    return;
  }
  const w = L.wide ? clamp(L.pic.w * 0.55, 160, 280) : clamp(L.view.w * 0.5, 150, 240);
  const h = (w * 4) / 3;
  const restX = L.view.x + L.view.w / 2;
  const restY = L.view.y + L.view.h * 0.38;
  const lands = !s.clip; // with no clip yet the flyer stays: it is the chapter's picture

  let cx = restX;
  let cy = restY;
  let rot = -5;
  let scale = 1;
  let opacity = 1;

  if (tl.reduced) {
    opacity = lands ? captionStates(tl, t).find((c) => c.index === i)?.opacity ?? 0 : 0;
  } else if (lands) {
    const landAt = s.enterStart + 0.95;
    if (t < landAt) {
      const p = between(t, s.enterStart, landAt);
      cy = lerp(L.view.y - h, restY, p * p);
      cx = restX + Math.sin(p * Math.PI * 1.6) * 0.1 * L.view.w * (1 - p);
      rot = lerp(-28, -5, easeOutCubic(p));
      scale = lerp(1.35, 1, p);
      opacity = smoothstep(p * 3);
    } else {
      const tau = t - landAt;
      cy -= 8 * Math.exp(-7 * tau) * Math.abs(Math.sin(16 * tau));
      rot += 4 * Math.exp(-6 * tau) * Math.sin(14 * tau);
    }
    // Found: when the next chapter comes in, the flyer is taken down.
    if (next && t > next.enterStart) {
      const q = between(t, next.enterStart, next.enterStart + 0.8);
      const e = easeInCubic(q);
      cx += 0.7 * L.view.w * e;
      cy -= 0.45 * L.view.h * e;
      rot += 28 * q;
      opacity *= 1 - smoothstep(between(q, 0.4, 1));
    }
  } else {
    // A clip follows: the flyer falls through the join and out of the frame.
    const p = between(t, s.enterStart, s.clipStart);
    cy = lerp(L.view.y - h, L.view.y + L.view.h + h, p);
    cx = restX + Math.sin(p * Math.PI * 2) * 0.14 * L.view.w;
    rot = lerp(-28, 40, p);
    opacity = p >= 1 ? 0 : 1;
  }

  setVisible(els.flyer, opacity > 0.001);
  els.flyer.style.width = `${w}px`;
  els.flyer.style.height = `${h}px`;
  els.flyer.style.transform = `translate3d(${cx - w / 2}px, ${cy - h / 2}px, 0) rotate(${rot}deg) scale(${scale})`;
  els.flyer.style.opacity = String(opacity);
}

// ─── stand-in moods ──────────────────────────────────────────────────────────

export function renderMood(els: OverlayEls, tl: Timeline, t: number): void {
  const mood = moodAt(tl, t);
  const rain = mood.rain * 0.8;
  setVisible(els.rain, rain > 0.003);
  if (rain > 0.003) {
    els.rain.style.opacity = String(rain);
    // The rain is drawn from the playhead too, so scrubbing runs it backwards.
    els.rain.style.backgroundPosition = tl.reduced ? "0 0" : `${(t * 90) % 400}px ${(t * 820) % 800}px, ${(t * 60) % 300}px ${(t * 560) % 600}px`;
  }
  const river = mood.river;
  setVisible(els.river, river > 0.003);
  if (river > 0.003) {
    els.river.style.opacity = String(river);
    els.river.style.backgroundPosition = tl.reduced ? "0 0" : `0 0, ${(t * 26) % 640}px 0, ${(-t * 12) % 520}px ${(t * 6) % 26}px, 0 0`;
  }
}

// ─── captions ────────────────────────────────────────────────────────────────

export function renderCaptions(els: OverlayEls, tl: Timeline, t: number, L: StageLayout): void {
  const states = captionStates(tl, t);
  const bottom = `${Math.max(0, L.H - (L.view.y + L.view.h))}px`;
  if (els.captionLayer.style.bottom !== bottom) {
    els.captionLayer.style.bottom = bottom;
    els.shade.style.bottom = bottom;
  }
  let shade = 0;
  els.captions.forEach((c, i) => {
    const st = states.find((x) => x.index === i);
    setVisible(c.root, Boolean(st));
    if (!st) return;
    const alpha = st.opacity * (1 - st.out);
    c.root.style.opacity = String(alpha);
    c.root.style.transform = st.out > 0 ? `translate3d(0, ${-16 * st.out}px, 0)` : "none";

    const kick = st.still ? 1 : smoothstep(between(st.local, 0, 0.45));
    c.kicker.style.opacity = String(kick);

    const id = tl.spans[i].chapter.id;
    c.letters.forEach((el, j) => {
      if (st.still) {
        el.style.transform = "none";
        el.style.opacity = "1";
        return;
      }
      const p = clamp01((st.local - 0.1 - j * CAPTION.stagger) / CAPTION.letter);
      if (p >= 1) {
        el.style.transform = "none";
        el.style.opacity = "1";
        return;
      }
      const e = easeOutBack(p);
      const dx = (rand(id, j * 4) - 0.5) * 1.1 * L.view.w;
      const dy = -(0.18 + rand(id, j * 4 + 1) * 0.55) * L.view.h;
      const r = (rand(id, j * 4 + 2) - 0.5) * 170;
      const sc = 1.6 + rand(id, j * 4 + 3) * 1.6;
      el.style.transform = `translate3d(${dx * (1 - e)}px, ${dy * (1 - e)}px, 0) rotate(${r * (1 - e)}deg) scale(${1 + (sc - 1) * (1 - e)})`;
      el.style.opacity = String(smoothstep(p * 2.4));
    });

    const sub = st.still ? 1 : smoothstep(between(st.local, CAPTION.lead - CAPTION.subtitle, CAPTION.lead - 0.05));
    c.subtitle.style.opacity = String(sub);
    c.subtitle.style.transform = sub < 1 ? `translate3d(0, ${(1 - sub) * 10}px, 0)` : "none";
    shade = Math.max(shade, alpha * Math.max(kick, sub, st.still ? 1 : smoothstep(between(st.local, 0, 0.8))));
  });
  els.shade.style.opacity = String(shade);
}

// ─── progress rail ───────────────────────────────────────────────────────────

export function renderRail(els: OverlayEls, tl: Timeline, t: number, L: StageLayout): void {
  const i = spanIndexAt(tl, t);
  els.rail.style.top = `${L.view.y + L.view.h / 2}px`;
  els.railFill.style.transform = `scaleY(${tl.end > 0 ? clamp01(t / tl.end) : 0})`;
  els.railDots.forEach((dot, k) => {
    const on = String(k === i);
    if (dot.dataset.on !== on) dot.dataset.on = on;
  });
}
