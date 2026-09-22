/**
 * The shape of a chapter draft (what /api/chapters/draft returns and the
 * chapter studio edits), its JSON schema for Claude's structured output, and
 * the sanitiser that makes whatever came back safe to store.
 */

export interface DraftScene {
  /** Index into the photos the owner uploaded. */
  photo: number;
  kicker: string;
  beats: string[];
  focus: { x: number; y: number };
  /** Image-to-video prompt for Kling 3.0 (the photo is the first frame). */
  videoPrompt: string;
}

export interface ChapterDraft {
  title: string;
  subtitle: string;
  description: string;
  dateLabel: string;
  scenes: DraftScene[];
}

/** Structured-output schema: every object closed, every field required. */
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "description", "dateLabel", "scenes"],
  properties: {
    title: { type: "string", description: "Chapter title, 2 to 5 words." },
    subtitle: { type: "string", description: "One line under the title, at most 90 characters." },
    description: { type: "string", description: "One or two sentences for the chapter tile, at most 220 characters." },
    dateLabel: {
      type: "string",
      description: "Short date in words if the owner's text implies one (\"April 2026\", \"Christmas Eve\"), otherwise an empty string.",
    },
    scenes: {
      type: "array",
      description: "Two to six scenes in story order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["photo", "kicker", "beats", "focusX", "focusY", "videoPrompt"],
        properties: {
          photo: { type: "integer", description: "0-based index of the photo this scene starts from." },
          kicker: { type: "string", description: "Optional small line above the words (a time or place), or an empty string." },
          beats: {
            type: "array",
            description: "One to three short lines that fade in over the photo, each at most 120 characters.",
            items: { type: "string" },
          },
          focusX: { type: "number", description: "Horizontal position of the pet's face or the key subject, 0 (left) to 1 (right)." },
          focusY: { type: "number", description: "Vertical position of the pet's face or the key subject, 0 (top) to 1 (bottom)." },
          videoPrompt: { type: "string", description: "Kling 3.0 image-to-video prompt for this photo, at most 600 characters." },
        },
      },
    },
  },
} as const;

const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
const unit = (v: unknown, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;

/** Accepts Claude's raw JSON (focusX/focusY) or an already-shaped draft. */
export function sanitiseDraft(raw: unknown, photoCount: number): ChapterDraft {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scenesIn = Array.isArray(o.scenes) ? (o.scenes as unknown[]) : [];
  const scenes: DraftScene[] = [];
  for (const s of scenesIn.slice(0, 8)) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const focus = r.focus && typeof r.focus === "object" ? (r.focus as Record<string, unknown>) : null;
    const photo = typeof r.photo === "number" && Number.isInteger(r.photo) ? r.photo : scenes.length;
    const beats = (Array.isArray(r.beats) ? r.beats : []).map((b) => clip(b, 160)).filter(Boolean).slice(0, 4);
    if (!beats.length) continue;
    scenes.push({
      photo: photoCount > 0 ? Math.min(photoCount - 1, Math.max(0, photo)) : 0,
      kicker: clip(r.kicker, 80),
      beats,
      focus: { x: unit(focus?.x ?? r.focusX, 0.5), y: unit(focus?.y ?? r.focusY, 0.42) },
      videoPrompt: clip(r.videoPrompt, 900),
    });
  }
  return {
    title: clip(o.title, 120) || "Untitled chapter",
    subtitle: clip(o.subtitle, 160),
    description: clip(o.description, 600),
    dateLabel: clip(o.dateLabel, 60),
    scenes,
  };
}

/**
 * A draft made without Claude: demo mode, or when no key is configured. One
 * scene per photo, the owner's own sentences shared out as the lines, and a
 * generic Kling prompt they can edit.
 */
export function cannedDraft(text: string, photoCount: number, petName: string): ChapterDraft {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Math.max(1, Math.min(6, photoCount || 1));
  const per = Math.max(1, Math.ceil(sentences.length / n));
  const firstWords = sentences[0]?.split(" ").slice(0, 4).join(" ").replace(/[.,;:!?]$/, "") ?? "";
  return {
    title: firstWords || `${petName}, again`,
    subtitle: sentences[1]?.slice(0, 90) ?? "",
    description: sentences.slice(0, 2).join(" ").slice(0, 220),
    dateLabel: "",
    scenes: Array.from({ length: n }, (_, i) => ({
      photo: i,
      kicker: "",
      beats: sentences.slice(i * per, i * per + per).slice(0, 3).length
        ? sentences.slice(i * per, i * per + per).slice(0, 3)
        : [`${petName}.`],
      focus: { x: 0.5, y: 0.42 },
      videoPrompt:
        `Very slow push-in. The ${petName.toLowerCase() === "kitty" ? "black-and-white cat" : "pet"} in the image makes one small, natural movement from exactly this pose (a slow blink, a turn of the head, ears moving), then settles. Keep the pet's markings, the room and the light exactly as in the photo. Photoreal, smooth steady camera, one continuous shot.`,
    })),
  };
}
