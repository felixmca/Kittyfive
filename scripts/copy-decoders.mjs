// The living-room GLB and cat model are Draco-compressed (geometry) and KTX2/Basis-compressed
// (textures). three.js decodes both inside web workers that it builds from
// loose files at a path you give it — DRACOLoader.setDecoderPath() and
// KTX2Loader.setTranscoderPath().
//
// Those files must be fetched at runtime, not imported. Bundlers resolve
// `import.meta.url` to a hashed chunk and do not emit sibling assets beside it,
// so any attempt to let the bundler find them ends with a 404 and a worker that
// dies silently — which is how a sibling project (Birthday Lobby) lost its map tiles once
//
// So: vendor them into /public from the installed three, on every predev and
// prebuild, so the copies can never drift from the version in node_modules.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libs = join(root, "node_modules", "three", "examples", "jsm", "libs");

const GROUPS = [
  {
    label: "draco",
    // The gltf/ build is the one GLTFLoader expects — it decodes the
    // KHR_draco_mesh_compression payload specifically.
    src: join(libs, "draco", "gltf"),
    dest: join(root, "public", "draco"),
    files: ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"],
  },
  {
    label: "basis",
    src: join(libs, "basis"),
    dest: join(root, "public", "basis"),
    files: ["basis_transcoder.js", "basis_transcoder.wasm"],
  },
];

for (const { label, src, dest, files } of GROUPS) {
  if (!existsSync(src)) {
    console.error(`[decoders] ${src} not found — run npm install first`);
    process.exit(1);
  }
  mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const from = join(src, f);
    if (!existsSync(from)) {
      console.error(`[decoders] missing ${label} file: ${from}`);
      process.exit(1);
    }
    copyFileSync(from, join(dest, f));
  }
  console.log(`[decoders] ${label} → public/${label} (${files.join(", ")})`);
}
