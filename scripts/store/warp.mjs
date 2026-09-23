// Perspective helpers for lifting flat things (a poster, a print) out of a
// photo: solve the homography that maps four corners in the photo onto a
// rectangle, then sample the photo through it (bilinear). Plain JS over
// sharp's raw RGB(A) buffers; no native dependencies.

/** Solve A·x = b (n×n, Gaussian elimination with partial pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) throw new Error("singular homography");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The 3×3 homography (row-major, h33 = 1) taking each `from[i]` to `to[i]`.
 * Points are [x, y].
 */
export function homography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

/**
 * Flatten the quadrilateral `corners` (top-left, top-right, bottom-right,
 * bottom-left, in source pixels) of `src` ({data, width, height, channels})
 * into a `w`×`h` image. Returns a raw buffer with the same channel count.
 */
export function warpQuad(src, corners, w, h) {
  const rect = [
    [0, 0],
    [w - 1, 0],
    [w - 1, h - 1],
    [0, h - 1],
  ];
  // Map output pixels back into the photo.
  const H = homography(rect, corners);
  const { data, width, height, channels } = src;
  const out = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / z;
      const sy = (H[3] * x + H[4] * y + H[5]) / z;
      const x0 = Math.max(0, Math.min(width - 2, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(height - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const o = (y * w + x) * channels;
      for (let c = 0; c < channels; c++) {
        const p = (yy, xx) => data[(yy * width + xx) * channels + c];
        const top = p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx;
        const bot = p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx;
        out[o + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}
