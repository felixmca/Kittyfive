"use client";
/**
 * Getting phone photos into the story-media bucket at a sensible size.
 *
 * A phone photo is 3–8 MB at 4000+ px; a tile needs ~1600 px. Resizing in the
 * browser before upload saves the owner's data plan and the bucket, and it is
 * the only resize available (Supabase image transforms need a paid plan).
 * EXIF orientation is honoured by createImageBitmap's `imageOrientation`.
 */

export interface PreparedImage {
  blob: Blob;
  type: string;
  ext: string;
  width: number;
  height: number;
}

const UNSUPPORTED =
  "This browser cannot open that photo format. Export it as JPEG (on iPhone: Share → Options → Most Compatible) and try again.";

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img>, which some browsers decode more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(UNSUPPORTED);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Resize so the long edge is at most `maxEdge`, as WebP (or JPEG where WebP encoding is missing, e.g. Safari). */
export async function prepareImage(file: Blob, maxEdge = 1600, quality = 0.84): Promise<PreparedImage> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("That is not an image.");
  const img = await decode(file);
  const w0 = "naturalWidth" in img ? img.naturalWidth : img.width;
  const h0 = "naturalHeight" in img ? img.naturalHeight : img.height;
  if (!w0 || !h0) throw new Error(UNSUPPORTED);
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the photo (no canvas).");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  if ("close" in img && typeof img.close === "function") img.close();

  let blob = await toBlob(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
  if (!blob) throw new Error("Could not prepare the photo.");
  const type = blob.type || "image/jpeg";
  return { blob, type, ext: type === "image/webp" ? "webp" : "jpg", width, height };
}

/** Small data URL, for demo mode where nothing is uploaded anywhere. */
export async function imageToDataUrl(file: Blob, maxEdge = 900): Promise<string> {
  const { blob } = await prepareImage(file, maxEdge, 0.72);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.readAsDataURL(blob);
  });
}

export function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
