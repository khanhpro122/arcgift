// Cleans the supplied ArcGift brand PNGs (no redesign) and exports web-ready assets.
//
//   NODE_PATH=web/node_modules node scripts/brand-assets.cjs <dir with extracted zip> web
//
// The supplied files have no real transparency (a semi-transparent white haze everywhere) and the
// favicons are off-centre crops. This keeps the artwork exactly as designed and only:
//  - turns the near-white background transparent (solid artwork stays opaque, edges stay smooth),
//  - drops stray haze that isn't touching the artwork (e.g. the brand sheet's colour smudge),
//  - takes the wordmark from the brand sheet (the light logo file cuts off the final "t"),
//  - makes a white-"Arc" wordmark for dark backgrounds, as in the supplied dark logo,
//  - rebuilds every icon size from the cleaned gift mark.
const { PNG } = require("pngjs");
const fs = require("fs");
const path = require("path");

const [SRC, WEB] = process.argv.slice(2);
const load = (f) => PNG.sync.read(fs.readFileSync(path.join(SRC, f)));
const save = (p, f) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, PNG.sync.write(p));
};

function crop(p, x0, y0, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * p.width + x0 + x) * 4;
      const j = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) o.data[j + c] = p.data[i + c];
    }
  return o;
}

/** White background → transparent. Solid artwork stays opaque; faint haze disappears. */
function keyWhite(p, t0 = 0.16, t1 = 0.5, keep = 3) {
  const W = p.width;
  const H = p.height;
  const o = new PNG({ width: W, height: H });
  const A = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    const a = p.data[i + 3] / 255;
    const C = [0, 1, 2].map((c) => p.data[i + c] * a + 255 * (1 - a)); // as seen on white
    const raw = Math.max(...C.map((v) => (255 - v) / 255));
    const al = Math.min(1, Math.max(0, (raw - t0) / (t1 - t0)));
    A[k] = al;
    for (let c = 0; c < 3; c++) {
      // opaque pixels keep their colour as seen on white; edge pixels get the white mixed back out
      const f = al >= 1 || raw <= 0 ? C[c] : (C[c] - 255 * (1 - raw)) / raw;
      o.data[i + c] = Math.max(0, Math.min(255, Math.round(f)));
    }
  }
  const solid = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) solid[k] = A[k] >= 0.9 ? 1 : 0;
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!solid[y * W + x]) continue;
      for (let dy = -keep; dy <= keep; dy++)
        for (let dx = -keep; dx <= keep; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < H && xx >= 0 && xx < W) near[yy * W + xx] = 1;
        }
    }
  for (let k = 0; k < W * H; k++) o.data[k * 4 + 3] = near[k] ? Math.round(A[k] * 255) : 0;
  return o;
}

/** Tight crop to visible pixels. */
function trim(p) {
  let x0 = p.width;
  let y0 = p.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      if (p.data[(y * p.width + x) * 4 + 3] > 8) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  return crop(p, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Premultiplied resample: area average when shrinking, bilinear when enlarging. */
function resize(p, W, H) {
  const o = new PNG({ width: W, height: H });
  const sx = p.width / W;
  const sy = p.height / H;
  const get = (x, y) => {
    x = Math.min(p.width - 1, Math.max(0, x));
    y = Math.min(p.height - 1, Math.max(0, y));
    const i = (y * p.width + x) * 4;
    const a = p.data[i + 3] / 255;
    return [p.data[i] * a, p.data[i + 1] * a, p.data[i + 2] * a, a];
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      if (sx >= 1) {
        const ya = Math.floor(y * sy);
        const yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
        const xa = Math.floor(x * sx);
        const xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
        for (let yy = ya; yy < yb; yy++)
          for (let xx = xa; xx < xb; xx++) {
            const v = get(xx, yy);
            for (let c = 0; c < 4; c++) acc[c] += v[c];
            n++;
          }
      } else {
        const fx = (x + 0.5) * sx - 0.5;
        const fy = (y + 0.5) * sy - 0.5;
        const bx = Math.floor(fx);
        const by = Math.floor(fy);
        const tx = fx - bx;
        const ty = fy - by;
        const taps = [
          [bx, by, (1 - tx) * (1 - ty)],
          [bx + 1, by, tx * (1 - ty)],
          [bx, by + 1, (1 - tx) * ty],
          [bx + 1, by + 1, tx * ty],
        ];
        for (const [xx, yy, w] of taps) {
          const v = get(xx, yy);
          for (let c = 0; c < 4; c++) acc[c] += v[c] * w;
        }
        n = 1;
      }
      const a = acc[3] / n;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) o.data[i + c] = a > 0 ? Math.round(acc[c] / n / a) : 0;
      o.data[i + 3] = Math.round(a * 255);
    }
  return o;
}

/** Centre `p` in a size×size canvas with padding, on an optional solid background. */
function square(p, size, padRatio, bg) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const sc = inner / Math.max(p.width, p.height);
  const r = resize(p, Math.max(1, Math.round(p.width * sc)), Math.max(1, Math.round(p.height * sc)));
  const o = new PNG({ width: size, height: size });
  if (bg)
    for (let k = 0; k < size * size; k++) {
      o.data[k * 4] = bg[0];
      o.data[k * 4 + 1] = bg[1];
      o.data[k * 4 + 2] = bg[2];
      o.data[k * 4 + 3] = 255;
    }
  const ox = Math.round((size - r.width) / 2);
  const oy = Math.round((size - r.height) / 2);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const j = ((y + oy) * size + x + ox) * 4;
      const a = r.data[i + 3] / 255;
      const ba = o.data[j + 3] / 255;
      const outA = a + ba * (1 - a);
      for (let c = 0; c < 3; c++)
        o.data[j + c] = outA > 0 ? Math.round((r.data[i + c] * a + o.data[j + c] * ba * (1 - a)) / outA) : 0;
      o.data[j + 3] = Math.round(outA * 255);
    }
  return o;
}

/** Dark navy "Arc" → white, as in the supplied dark logo (same geometry as the light one). */
function darkTextToWhite(p) {
  const o = new PNG({ width: p.width, height: p.height });
  p.data.copy(o.data);
  for (let i = 0; i < o.data.length; i += 4) {
    const r = o.data[i];
    const g = o.data[i + 1];
    const b = o.data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 110 && max - min < 45) o.data[i] = o.data[i + 1] = o.data[i + 2] = 255;
  }
  return o;
}

/** .ico containing PNG images (supported by all current browsers). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  const bodies = [];
  pngs.forEach((p, k) => {
    const buf = PNG.sync.write(p);
    const e = 6 + 16 * k;
    header.writeUInt8(p.width >= 256 ? 0 : p.width, e);
    header.writeUInt8(p.height >= 256 ? 0 : p.height, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
    bodies.push(buf);
  });
  return Buffer.concat([header, ...bodies]);
}

const light = load("arcgift-logo-light.png");
const sheet = load("arcgift-brand-sheet.png");

const mark = trim(keyWhite(crop(light, 0, 0, 345, 330))); // stop before the "A"
const wordLight = trim(keyWhite(crop(sheet, 390, 110, 660, 200)));
const wordDark = darkTextToWhite(wordLight);

const pub = path.join(WEB, "public/brand");
save(mark, path.join(pub, "arcgift-mark.png"));
save(wordLight, path.join(pub, "arcgift-wordmark-light.png"));
save(wordDark, path.join(pub, "arcgift-wordmark-dark.png"));

const WHITE = [255, 255, 255];
save(square(mark, 192, 0.14, WHITE), path.join(pub, "icon-192.png"));
save(square(mark, 512, 0.14, WHITE), path.join(pub, "icon-512.png"));
const app = path.join(WEB, "src/app");
save(square(mark, 180, 0.12, WHITE), path.join(app, "apple-icon.png"));
save(square(mark, 192, 0.02), path.join(app, "icon.png"));
fs.writeFileSync(path.join(app, "favicon.ico"), ico([16, 32, 48].map((s) => square(mark, s, 0))));

console.log("mark", `${mark.width}x${mark.height}`, "wordmark", `${wordLight.width}x${wordLight.height}`);
