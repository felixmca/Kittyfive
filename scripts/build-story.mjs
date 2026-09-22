// ─── STORY ASSET PIPELINE ────────────────────────────────────────────────────
//
//   assets-raw/story/<scene-id>/clip.mp4     (from artta.ai, any length/size)
//   assets-raw/story/<scene-id>/still.jpg    (or a single image)
//   assets-raw/turntable/*.jpg               (N photos of Kitty, in spin order)
//
//        ⇩  npm run story   (also runs on predev / prebuild)
//
//   public/story/<scene-id>/0001.webp … 00NN.webp + manifest.json
//   public/turntable/0001.webp … + manifest.json
//
// WHY FRAMES, NOT <video>: iOS Safari will not scrub a <video> element with
// currentTime smoothly on scroll (it decodes on a separate thread, seeks land
// late and jitter, and it refuses to play without a user gesture). A folder of
// WebP frames drawn onto a <canvas> is how every "Apple product page" scroll
// story actually works, and it is deterministic on every phone.
//
// BUDGET: 720 px wide, 9:16, ~72 frames per scene, WebP q=72 lands around
// 2–3 MB per scene decoded lazily. 11 scenes ≈ 25–35 MB over the session,
// fetched progressively as the reader scrolls, never all at once.
//
// Idempotent: a scene whose newest raw file is older than its manifest is
// skipped. Absent-source-safe: with no assets-raw at all (e.g. on Vercel) it
// exits 0 and leaves whatever is already committed in public/story.

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
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(root, "assets-raw");
const PUB = join(root, "public");

const FRAMES_PER_SCENE = Number(process.env.STORY_FRAMES ?? 72);
const WIDTH = Number(process.env.STORY_WIDTH ?? 720);
const QUALITY = Number(process.env.STORY_QUALITY ?? 72);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function ffmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    const pw = join(
      process.env.LOCALAPPDATA ?? "",
      "ms-playwright",
    );
    if (existsSync(pw)) {
      const dir = readdirSync(pw).find((d) => d.startsWith("ffmpeg-"));
      if (dir) return join(pw, dir, "ffmpeg-win64.exe");
    }
    return null;
  }
}

function newest(dir) {
  let t = 0;
  for (const f of readdirSync(dir)) {
    const s = statSync(join(dir, f));
    if (s.isFile()) t = Math.max(t, s.mtimeMs);
  }
  return t;
}

function upToDate(outDir, sourceMtime) {
  const m = join(outDir, "manifest.json");
  return existsSync(m) && statSync(m).mtimeMs >= sourceMtime;
}

function pad(n) {
  return String(n).padStart(4, "0");
}

async function sharp() {
  const mod = await import("sharp");
  return mod.default;
}

function probeDuration(bin, file) {
  // ffmpeg prints duration to stderr; ffprobe may not be beside a Playwright ffmpeg.
  try {
    execFileSync(bin, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(e.stderr));
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

async function buildSequenceFromVideo(bin, file, outDir) {
  const duration = probeDuration(bin, file);
  if (!duration) throw new Error(`could not read duration of ${file}`);
  const fps = FRAMES_PER_SCENE / duration;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  // scale to WIDTH, keep aspect, even height; write WebP directly.
  execFileSync(
    bin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `fps=${fps.toFixed(4)},scale=${WIDTH}:-2:flags=lanczos`,
      "-frames:v",
      String(FRAMES_PER_SCENE),
      "-c:v",
      "libwebp",
      "-quality",
      String(QUALITY),
      "-compression_level",
      "6",
      join(outDir, "%04d.webp"),
    ],
    { stdio: "inherit" },
  );
  const frames = readdirSync(outDir).filter((f) => f.endsWith(".webp")).sort();
  const S = await sharp();
  const meta = await S(join(outDir, frames[0])).metadata();
  return { frames: frames.length, width: meta.width, height: meta.height, duration };
}

async function buildSequenceFromImage(file, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const S = await sharp();
  const out = join(outDir, "0001.webp");
  await S(file).resize({ width: WIDTH }).webp({ quality: QUALITY }).toFile(out);
  const meta = await S(out).metadata();
  return { frames: 1, width: meta.width, height: meta.height, duration: 0 };
}

async function buildScene(bin, sceneId) {
  const inDir = join(RAW, "story", sceneId);
  const outDir = join(PUB, "story", sceneId);
  const files = readdirSync(inDir).filter((f) => !f.startsWith("."));
  const video = files.find((f) => VIDEO_EXT.has(extname(f).toLowerCase()));
  const image = files.find((f) => IMAGE_EXT.has(extname(f).toLowerCase()));
  if (!video && !image) return null;
  const src = newest(inDir);
  if (upToDate(outDir, src)) {
    console.log(`[story] ${sceneId}: up to date`);
    return JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  }
  let info;
  if (video) {
    if (!bin) throw new Error("ffmpeg not found; install with `winget install Gyan.FFmpeg`");
    info = await buildSequenceFromVideo(bin, join(inDir, video), outDir);
  } else {
    info = await buildSequenceFromImage(join(inDir, image), outDir);
  }
  const manifest = {
    id: sceneId,
    source: video ?? image,
    ...info,
    pattern: "%04d.webp",
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[story] ${sceneId}: ${info.frames} frames @ ${info.width}×${info.height}`);
  return manifest;
}

const TURNTABLE_FRAMES = Number(process.env.TURNTABLE_FRAMES ?? 36);

async function buildTurntable(bin) {
  const inDir = join(RAW, "turntable");
  const outDir = join(PUB, "turntable");
  if (!existsSync(inDir)) return;
  const all = readdirSync(inDir).filter((f) => !f.startsWith("."));
  const video = all.find((f) => VIDEO_EXT.has(extname(f).toLowerCase()));
  const files = all.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort();
  if (!video && !files.length) return;
  if (upToDate(outDir, newest(inDir))) {
    console.log(`[turntable] up to date`);
    return;
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const S = await sharp();
  let i = 0;
  let size = null;

  if (video) {
    // One slow walk around a sitting cat is far easier to shoot than 36 stills.
    // Extract TURNTABLE_FRAMES evenly spaced frames, centre-crop to square.
    if (!bin) throw new Error("ffmpeg not found; install with `winget install Gyan.FFmpeg`");
    const duration = probeDuration(bin, join(inDir, video));
    if (!duration) throw new Error(`could not read duration of ${video}`);
    const fps = TURNTABLE_FRAMES / duration;
    execFileSync(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        join(inDir, video),
        "-vf",
        `fps=${fps.toFixed(4)},scale=900:900:force_original_aspect_ratio=increase,crop=900:900`,
        "-frames:v",
        String(TURNTABLE_FRAMES),
        "-c:v",
        "libwebp",
        "-quality",
        "80",
        join(outDir, "%04d.webp"),
      ],
      { stdio: "inherit" },
    );
    i = readdirSync(outDir).filter((f) => f.endsWith(".webp")).length;
    size = await S(join(outDir, "0001.webp")).metadata();
  } else {
    for (const f of files) {
      i++;
      const out = join(outDir, `${pad(i)}.webp`);
      await S(join(inDir, f))
        .rotate() // honour EXIF orientation from the phone
        .resize({ width: 900, height: 900, fit: "cover" })
        .webp({ quality: 80 })
        .toFile(out);
      size ??= await S(out).metadata();
    }
  }
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        frames: i,
        width: size.width,
        height: size.height,
        pattern: "%04d.webp",
        source: video ?? `${files.length} stills`,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`[turntable] ${i} frames from ${video ?? "stills"}`);
}

/**
 * Cut-outs: assets-raw/cutouts/<name>.mp4 shot/generated against flat chroma
 * green becomes public/story/cutouts/<name>/0001.webp… with real alpha
 * (yuva420p WebP), so Kitty can walk between the photo frames. A plain PNG in
 * the same folder is copied through as public/story/cutouts/<name>.png.
 */
async function buildCutouts(bin) {
  const inDir = join(RAW, "cutouts");
  const outRoot = join(PUB, "story", "cutouts");
  if (!existsSync(inDir)) return;
  mkdirSync(outRoot, { recursive: true });
  const S = await sharp();
  for (const f of readdirSync(inDir).filter((f) => !f.startsWith("."))) {
    const ext = extname(f).toLowerCase();
    const name = f.slice(0, -ext.length);
    const src = join(inDir, f);
    if (IMAGE_EXT.has(ext)) {
      const out = join(outRoot, `${name}.png`);
      if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
      await S(src).png().toFile(out);
      console.log(`[cutouts] ${name}.png`);
    } else if (VIDEO_EXT.has(ext)) {
      const outDir = join(outRoot, name);
      if (upToDate(outDir, statSync(src).mtimeMs)) continue;
      if (!bin) throw new Error("ffmpeg not found; install with `winget install Gyan.FFmpeg`");
      const duration = probeDuration(bin, src);
      if (!duration) throw new Error(`could not read duration of ${f}`);
      const frames = 48;
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      execFileSync(
        bin,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          src,
          "-vf",
          `fps=${(frames / duration).toFixed(4)},scale=${WIDTH}:-2:flags=lanczos,chromakey=0x00FF00:0.10:0.08,despill=type=green`,
          "-frames:v",
          String(frames),
          "-c:v",
          "libwebp",
          "-quality",
          "85",
          "-compression_level",
          "6",
          "-pix_fmt",
          "yuva420p",
          join(outDir, "%04d.webp"),
        ],
        { stdio: "inherit" },
      );
      const n = readdirSync(outDir).filter((x) => x.endsWith(".webp")).length;
      const meta = await S(join(outDir, "0001.webp")).metadata();
      writeFileSync(
        join(outDir, "manifest.json"),
        JSON.stringify(
          { frames: n, width: meta.width, height: meta.height, pattern: "%04d.webp", alpha: true, source: f, builtAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      console.log(`[cutouts] ${name}: ${n} alpha frames`);
    }
  }
}

async function main() {
  const storyRaw = join(RAW, "story");
  const bin = ffmpeg();
  if (!existsSync(storyRaw)) {
    console.log("[story] no assets-raw/story; keeping committed public/story as is");
  } else {
    const scenes = readdirSync(storyRaw).filter((d) =>
      statSync(join(storyRaw, d)).isDirectory(),
    );
    const index = {};
    for (const id of scenes) {
      try {
        const m = await buildScene(bin, id);
        if (m) index[id] = { frames: m.frames, width: m.width, height: m.height };
      } catch (e) {
        console.error(`[story] ${id}: ${e.message}`);
        process.exitCode = 1;
      }
    }
    mkdirSync(join(PUB, "story"), { recursive: true });
    // Merge with anything already committed so a partial local run never
    // erases scenes built on another machine.
    const indexPath = join(PUB, "story", "index.json");
    const prev = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
    writeFileSync(indexPath, JSON.stringify({ ...prev, ...index }, null, 2));
    console.log(`[story] index: ${Object.keys({ ...prev, ...index }).length} scene(s) with media`);
  }
  await buildTurntable(bin);
  await buildCutouts(bin);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
