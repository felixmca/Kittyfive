// Runs one of the store's Blender build scripts headless (no window, no
// add-ons, factory settings), so the models are made the same way every time.
//
//   node scripts/room/blender.mjs scripts/room/room.py
//
// Blender is found at BLENDER, else the usual Windows install (5.2).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const script = process.argv[2];
if (!script) {
  console.error("usage: node scripts/room/blender.mjs <script.py> [-- args]");
  process.exit(2);
}
const candidates = [
  process.env.BLENDER,
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe",
  "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe",
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "blender",
].filter(Boolean);
const blender = candidates.find((c) => c === "blender" || existsSync(c));
const extra = process.argv.slice(3);
const r = spawnSync(blender, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", resolve(script), "--", ...extra], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
