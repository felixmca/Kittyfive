/**
 * The store's light: day or evening, the way it is at Kitty's (London time)
 * unless the visitor flips it. One mutable record, eased once per frame by
 * <AmbienceClock/> in StoreScene and read by everything that glows (lights,
 * the river window, the garden) inside their own useFrame, so a change of
 * light never re-renders React.
 */

export type LightMood = "day" | "evening";

export interface Ambience {
  /** 0 = day, 1 = evening, eased towards `target`. */
  evening: number;
  target: number;
  /** Seconds since the scene started (for the river, the plants, the rain of light). */
  time: number;
}

export const ambience: Ambience = { evening: 0, target: 0, time: 0 };

/** Evening at Kitty's: from 7pm to 7am in London. */
export function moodAtKittys(date: Date = new Date()): LightMood {
  let hour = date.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(date));
  } catch {
    /* no time zone data: UTC is close enough */
  }
  return hour >= 19 || hour < 7 ? "evening" : "day";
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
