// ─── STORY ASSET PIPELINE ────────────────────────────────────────────────────
//
//   assets-raw/story/<chapter>/clip/*.mp4          the artta clip (newest wins)
//   assets-raw/story/<chapter>/start-frame/*.jpg   the photo the clip starts from
//   assets-raw/story/<chapter>/extras/*.jpg        real photos from the same time
//   assets-raw/ui/flyer/*.png|jpg                  the MISSING flyer
//   assets-raw/ui/cutout/*.png                     transparent Kitty, side-on
//                          *.mp4                   (or a green-screen walk clip)
//   assets-raw/ui/portrait/*.jpg                   the favourite photo
//   assets-raw/turntable/orbit.mp4 or *.jpg        the 360° spin
//
//        ⇩  npm run story   (also runs on predev / prebuild)
//
//   public/story/<chapter>/0001.webp … + manifest.json   frames, if there is a clip
//   public/story/<chapter>/still.webp                    the start frame (poster)
//   public/story/<chapter>/still.jpg                     the same, for link previews
//   public/story/<chapter>/extras/01.webp … + media.json the extras
//   public/story/index.json                              which chapters have frames
//   public/story/flyer.webp, public/story/cutouts/kitty-walk.png (or walk/…)
//   public/og.png (1200×630 share image), public/story/portrait.webp
//   public/story/whatsapp-chat.webp + .json (from assets-raw/ui/whatsapp, pre-blurred)
//   public/turntable/0001.webp … + manifest.json
//
// The old flat layout (clip.mp4 / still.jpg directly in the chapter folder)
// still works. iPhone HEIC photos are converted on the way through.
//
// WHY FRAMES, NOT <video>: iOS Safari will not scrub a <video> smoothly on
// scroll (seeks land late and jitter, and it needs a user gesture). A folder
// of WebP frames drawn on a <canvas> is how Apple's own product pages do it.
//
// BUDGET: 720 px wide, 9:16, 72 frames per chapter, WebP q=72: about 2–3 MB
// per chapter, fetched progressively as the reader scrolls.
//
// Idempotent: a chapter whose newest raw file is older than its build stamp is
// skipped. With no assets-raw at all (e.g. on Vercel) it exits 0 and leaves
// whatever is committed in public/.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(root, "assets-raw");
const PUB = join(root, "public");

const FRAMES_PER_SCENE = Number(process.env.STORY_FRAMES ?? 72);
const WIDTH = Number(process.env.STORY_WIDTH ?? 720);
const QUALITY = Number(process.env.STORY_QUALITY ?? 72);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"]);
const HEIC_EXT = new Set([".heic", ".heif"]);
const STAMP = ".built";

// ─── helpers ─────────────────────────────────────────────────────────────────

function ffmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    const pw = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
    if (existsSync(pw)) {
      const dir = readdirSync(pw).find((d) => d.startsWith("ffmpeg-"));
      if (dir) return join(pw, dir, "ffmpeg-win64.exe");
    }
    return null;
  }
}

/** Files (not folders) in `dir` with one of `exts`, oldest first. Missing dir → []. */
function filesIn(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && exts.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

const newest = (dir, exts) => filesIn(dir, exts).at(-1) ?? null;
const mtime = (p) => (p && existsSync(p) ? statSync(p).mtimeMs : 0);

function upToDate(outDir, sourceMtime) {
  const stamp = join(outDir, STAMP);
  return existsSync(stamp) && statSync(stamp).mtimeMs >= sourceMtime;
}

function stamp(outDir) {
  writeFileSync(join(outDir, STAMP), new Date().toISOString());
}

async function sharp() {
  const mod = await import("sharp");
  return mod.default;
}

/**
 * Something sharp can read: the path itself, or for HEIC (which sharp's
 * prebuilt binaries cannot decode) a JPEG buffer converted in pure JS.
 */
async function readable(file) {
  if (!HEIC_EXT.has(extname(file).toLowerCase())) return file;
  const { default: convert } = await import("heic-convert");
  return Buffer.from(await convert({ buffer: readFileSync(file), format: "JPEG", quality: 0.92 }));
}

function probeDuration(bin, file) {
  // ffmpeg prints the duration to stderr; ffprobe may not sit beside a Playwright ffmpeg.
  try {
    execFileSync(bin, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(e.stderr));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

function clearFrames(outDir) {
  if (!existsSync(outDir)) return;
  for (const f of readdirSync(outDir)) {
    if (/^\d{4}\.webp$/.test(f) || f === "manifest.json") rmSync(join(outDir, f), { force: true });
  }
}

// ─── chapters ────────────────────────────────────────────────────────────────

async function framesFromVideo(bin, file, outDir) {
  const duration = probeDuration(bin, file);
  if (!duration) throw new Error(`could not read the duration of ${file}`);
  const fps = FRAMES_PER_SCENE / duration;
  clearFrames(outDir);
  execFileSync(
    bin,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-vf", `fps=${fps.toFixed(4)},scale='min(${WIDTH},iw)':-2:flags=lanczos`,
      "-frames:v", String(FRAMES_PER_SCENE),
      "-c:v", "libwebp", "-quality", String(QUALITY), "-compression_level", "6",
      join(outDir, "%04d.webp"),
    ],
    { stdio: "inherit" },
  );
  const frames = readdirSync(outDir).filter((f) => /^\d{4}\.webp$/.test(f)).sort();
  if (!frames.length) throw new Error(`ffmpeg wrote no frames for ${file}`);
  const S = await sharp();
  const meta = await S(join(outDir, frames[0])).metadata();
  return { frames: frames.length, width: meta.width, height: meta.height, duration };
}

async function buildChapter(bin, id) {
  const inDir = join(RAW, "story", id);
  const outDir = join(PUB, "story", id);
  const clip = newest(join(inDir, "clip"), VIDEO_EXT) ?? newest(inDir, VIDEO_EXT);
  const start = newest(join(inDir, "start-frame"), IMAGE_EXT) ?? newest(inDir, IMAGE_EXT);
  // Extras keep their names (Kittens1, end-frame…) so the story can place
  // specific ones; natural sort, so Kittens2 comes before Kittens10.
  const extras = filesIn(join(inDir, "extras"), IMAGE_EXT).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
  if (!clip && !start && !extras.length) return null;

  const sourceMtime = Math.max(mtime(clip), mtime(start), ...extras.map(mtime), statSync(inDir).mtimeMs);
  if (upToDate(outDir, sourceMtime)) {
    console.log(`[story] ${id}: up to date`);
    const m = join(outDir, "manifest.json");
    return existsSync(m) ? JSON.parse(readFileSync(m, "utf8")) : { frames: 0 };
  }
  mkdirSync(outDir, { recursive: true });
  const S = await sharp();

  let manifest = { frames: 0 };
  if (clip) {
    if (!bin) throw new Error("ffmpeg not found; install it with `winget install Gyan.FFmpeg`");
    const info = await framesFromVideo(bin, clip, outDir);
    manifest = { id, source: clip.slice(inDir.length + 1), ...info, pattern: "%04d.webp", builtAt: new Date().toISOString() };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  } else {
    clearFrames(outDir);
  }

  if (start) {
    await S(await readable(start)).rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(outDir, "still.webp"));
    // A JPEG twin for link previews: WhatsApp and others do not all show WebP.
    await S(join(outDir, "still.webp")).jpeg({ quality: 82, mozjpeg: true }).toFile(join(outDir, "still.jpg"));
  } else {
    rmSync(join(outDir, "still.webp"), { force: true });
    rmSync(join(outDir, "still.jpg"), { force: true });
  }

  const extrasOut = join(outDir, "extras");
  rmSync(extrasOut, { recursive: true, force: true });
  const extrasList = [];
  if (extras.length) {
    mkdirSync(extrasOut, { recursive: true });
    const used = new Set();
    for (const file of extras) {
      let slug = basename(file).replace(/.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
      while (used.has(slug)) slug += "-2";
      used.add(slug);
      const name = `${slug}.webp`;
      const info = await S(await readable(file))
        .rotate()
        .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(join(extrasOut, name));
      // End frames become chapter tiles, so they get a JPEG twin for link previews too.
      if (slug === "end-frame") {
        await S(join(extrasOut, name)).jpeg({ quality: 82, mozjpeg: true }).toFile(join(extrasOut, `${slug}.jpg`));
      }
      extrasList.push({ name: slug, src: `/story/${id}/extras/${name}`, width: info.width, height: info.height });
    }
  }

  writeFileSync(
    join(outDir, "media.json"),
    JSON.stringify({ id, frames: manifest.frames, still: Boolean(start), extras: extrasList }, null, 2),
  );
  stamp(outDir);
  console.log(
    `[story] ${id}: ${manifest.frames ? `${manifest.frames} frames @ ${manifest.width}×${manifest.height}` : "no clip yet"}` +
      `${start ? " · still" : ""}${extrasList.length ? ` · ${extrasList.length} extras` : ""}`,
  );
  return manifest;
}

// ─── the rest of the story's pictures ────────────────────────────────────────

async function buildUi(bin) {
  const S = await sharp();
  const ui = join(RAW, "ui");

  const flyer = newest(join(ui, "flyer"), IMAGE_EXT);
  const flyerOut = join(PUB, "story", "flyer.webp");
  if (flyer && mtime(flyer) > mtime(flyerOut)) {
    await S(await readable(flyer)).rotate().resize({ height: 1400, withoutEnlargement: true }).webp({ quality: 86 }).toFile(flyerOut);
    console.log("[ui] flyer.webp");
  }
  if (existsSync(join(ui, "flyer")) && readdirSync(join(ui, "flyer")).some((f) => f.toLowerCase().endsWith(".pdf")) && !flyer) {
    console.log("[ui] flyer: found a PDF; export it as PNG or JPEG (the pipeline reads images).");
  }

  const cutoutDir = join(ui, "cutout");
  const cutoutPng = newest(cutoutDir, new Set([".png", ".webp"]));
  const cutoutOut = join(PUB, "story", "cutouts", "kitty-walk.png");
  if (cutoutPng && mtime(cutoutPng) > mtime(cutoutOut)) {
    mkdirSync(dirname(cutoutOut), { recursive: true });
    await S(cutoutPng).resize({ height: 900, withoutEnlargement: true }).png().toFile(cutoutOut);
    console.log("[ui] cutouts/kitty-walk.png");
  }
  const cutoutClip = newest(cutoutDir, VIDEO_EXT);
  if (cutoutClip) await alphaWalk(bin, cutoutClip, join(PUB, "story", "cutouts", "walk"));

  // ui/whatsapp/*.jpg: the neighbours' chat, ALREADY BLURRED (names, numbers,
  // avatars, house number). The unblurred original lives in ui/whatsapp/original/
  // and is never read here. The sidecar JSON says where the photo sits in it;
  // only those numbers are published, because the sidecar's notes and keys
  // can name the neighbours.
  const chat = newest(join(ui, "whatsapp"), IMAGE_EXT);
  const chatOut = join(PUB, "story", "whatsapp-chat.webp");
  const sidecar = join(ui, "whatsapp", "whatsapp-chat.json");
  if (chat && Math.max(mtime(chat), mtime(sidecar)) > mtime(chatOut)) {
    await S(await readable(chat)).rotate().webp({ quality: 84 }).toFile(chatOut);
    if (existsSync(sidecar)) {
      const { width, height, photo } = JSON.parse(readFileSync(sidecar, "utf8"));
      const rect = photo && { x: photo.x, y: photo.y, w: photo.w, h: photo.h };
      writeFileSync(join(PUB, "story", "whatsapp-chat.json"), JSON.stringify({ width, height, photo: rect }, null, 2));
    }
    console.log("[ui] whatsapp-chat.webp");
  }

  const portrait = newest(join(ui, "portrait"), IMAGE_EXT);
  const ogOut = join(PUB, "og.png");
  if (portrait && mtime(portrait) > mtime(ogOut)) {
    const input = await readable(portrait);
    await S(input).rotate().resize(1200, 630, { fit: "cover", position: "attention" }).png().toFile(ogOut);
    await S(input).rotate().resize({ width: 1080, height: 1080, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(join(PUB, "story", "portrait.webp"));
    console.log("[ui] og.png + portrait.webp");
  }
}

/** A clip of Kitty walking on flat chroma green → frames with real alpha. */
async function alphaWalk(bin, src, outDir) {
  if (upToDate(outDir, mtime(src))) return;
  if (!bin) throw new Error("ffmpeg not found; install it with `winget install Gyan.FFmpeg`");
  const duration = probeDuration(bin, src);
  if (!duration) throw new Error(`could not read the duration of ${src}`);
  const frames = 48;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync(
    bin,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", src,
      "-vf", `fps=${(frames / duration).toFixed(4)},scale=${WIDTH}:-2:flags=lanczos,chromakey=0x00FF00:0.10:0.08,despill=type=green`,
      "-frames:v", String(frames),
      "-c:v", "libwebp", "-quality", "85", "-compression_level", "6", "-pix_fmt", "yuva420p",
      join(outDir, "%04d.webp"),
    ],
    { stdio: "inherit" },
  );
  const n = readdirSync(outDir).filter((x) => x.endsWith(".webp")).length;
  const S = await sharp();
  const meta = await S(join(outDir, "0001.webp")).metadata();
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({ frames: n, width: meta.width, height: meta.height, pattern: "%04d.webp", alpha: true, builtAt: new Date().toISOString() }, null, 2),
  );
  stamp(outDir);
  console.log(`[ui] cutouts/walk: ${n} alpha frames`);
}

const TURNTABLE_FRAMES = Number(process.env.TURNTABLE_FRAMES ?? 36);

async function buildTurntable(bin) {
  const inDir = join(RAW, "turntable");
  const outDir = join(PUB, "turntable");
  const video = newest(inDir, VIDEO_EXT);
  const stills = filesIn(inDir, IMAGE_EXT).sort();
  if (!video && !stills.length) return;
  if (upToDate(outDir, Math.max(mtime(video), ...stills.map(mtime)))) {
    console.log("[turntable] up to date");
    return;
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const S = await sharp();
  let n = 0;
  if (video) {
    // One slow walk around a sitting cat is far easier to shoot than 36 stills.
    if (!bin) throw new Error("ffmpeg not found; install it with `winget install Gyan.FFmpeg`");
    const duration = probeDuration(bin, video);
    if (!duration) throw new Error(`could not read the duration of ${video}`);
    execFileSync(
      bin,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", video,
        "-vf", `fps=${(TURNTABLE_FRAMES / duration).toFixed(4)},scale=900:900:force_original_aspect_ratio=increase,crop=900:900`,
        "-frames:v", String(TURNTABLE_FRAMES),
        "-c:v", "libwebp", "-quality", "80",
        join(outDir, "%04d.webp"),
      ],
      { stdio: "inherit" },
    );
    n = readdirSync(outDir).filter((f) => f.endsWith(".webp")).length;
  } else {
    for (const f of stills) {
      n++;
      await S(await readable(f)).rotate().resize({ width: 900, height: 900, fit: "cover" }).webp({ quality: 80 }).toFile(join(outDir, `${String(n).padStart(4, "0")}.webp`));
    }
  }
  const meta = await S(join(outDir, "0001.webp")).metadata();
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({ frames: n, width: meta.width, height: meta.height, pattern: "%04d.webp", builtAt: new Date().toISOString() }, null, 2),
  );
  stamp(outDir);
  console.log(`[turntable] ${n} frames`);
}

/** The old drop zone for cut-outs (assets-raw/cutouts), kept working. */
async function buildLegacyCutouts(bin) {
  const inDir = join(RAW, "cutouts");
  if (!existsSync(inDir)) return;
  const S = await sharp();
  const outRoot = join(PUB, "story", "cutouts");
  mkdirSync(outRoot, { recursive: true });
  for (const f of readdirSync(inDir).filter((x) => !x.startsWith("."))) {
    const ext = extname(f).toLowerCase();
    const name = f.slice(0, -ext.length);
    const src = join(inDir, f);
    if (IMAGE_EXT.has(ext)) {
      const out = join(outRoot, `${name}.png`);
      if (mtime(out) >= mtime(src)) continue;
      await S(await readable(src)).png().toFile(out);
      console.log(`[cutouts] ${name}.png`);
    } else if (VIDEO_EXT.has(ext)) {
      await alphaWalk(bin, src, join(outRoot, name));
    }
  }
}

async function main() {
  const storyRaw = join(RAW, "story");
  const bin = ffmpeg();
  if (!existsSync(storyRaw)) {
    console.log("[story] no assets-raw/story; keeping committed public/story as is");
  } else {
    const chapters = readdirSync(storyRaw).filter((d) => statSync(join(storyRaw, d)).isDirectory());
    const index = {};
    for (const id of chapters) {
      try {
        const m = await buildChapter(bin, id);
        if (m?.frames) index[id] = { frames: m.frames, width: m.width, height: m.height };
      } catch (e) {
        console.error(`[story] ${id}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    mkdirSync(join(PUB, "story"), { recursive: true });
    // Merge with what is already committed (a partial local run must never
    // erase chapters built on another machine: their folders exist here too,
    // because the READMEs are committed), and drop chapters that are no longer
    // in the story at all.
    const indexPath = join(PUB, "story", "index.json");
    const prev = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
    const merged = Object.fromEntries(Object.entries({ ...prev, ...index }).filter(([id]) => chapters.includes(id)));
    writeFileSync(indexPath, JSON.stringify(merged, null, 2));
    console.log(`[story] index: ${Object.keys(merged).length} chapter(s) with frames`);
  }
  try {
    await buildUi(bin);
  } catch (e) {
    console.error(`[ui] ${e.message}`);
    process.exitCode = 1;
  }
  await buildTurntable(bin);
  await buildLegacyCutouts(bin);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
