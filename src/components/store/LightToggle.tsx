"use client";
/**
 * Day or evening in Kitty's room. The store opens as it is at her place in
 * London (evening from 7pm); this flips it. A 44px glass button under the
 * menu, showing the light you are in: the sun by day, the moon by evening.
 */
import { BELOW_CHROME } from "@/components/chrome/layout";
import { useStoreState } from "./storeState";

export default function LightToggle() {
  const mood = useStoreState((s) => s.lightMood);
  const setMood = useStoreState((s) => s.setLightMood);
  const evening = mood === "evening";
  return (
    <button
      type="button"
      onClick={() => setMood(evening ? "day" : "evening")}
      aria-label={evening ? "Evening light. Switch to daylight" : "Daylight. Switch to evening light"}
      aria-pressed={evening}
      title={evening ? "Evening at Kitty's" : "Daytime at Kitty's"}
      data-light-toggle={mood}
      className="glass fixed z-20 flex h-11 w-11 items-center justify-center rounded-full text-fg transition-transform active:scale-95"
      style={{ top: BELOW_CHROME, right: "max(12px, env(safe-area-inset-right))" }}
    >
      {evening ? (
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="#ffd166" stroke="#ffd166" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.2" fill="#ffd166" />
          {Array.from({ length: 8 }, (_, i) => (
            <path
              key={i}
              d="M12 2.5v2.4"
              stroke="#ffd166"
              strokeWidth="1.6"
              strokeLinecap="round"
              transform={`rotate(${i * 45} 12 12)`}
            />
          ))}
        </svg>
      )}
    </button>
  );
}
