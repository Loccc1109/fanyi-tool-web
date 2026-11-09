// Pure, testable image operations. Original RGBA is never warped.
export function validateParams(params, width, height) {
  const p = { dx: 0, dy: 0, sx: 1, sy: 1, color: false, ...params };
  if (![p.dx, p.dy, p.sx, p.sy].every(Number.isFinite) || p.sx < .9 || p.sx > 1.1 || p.sy < .9 || p.sy > 1.1 || Math.abs(p.dx) > width * .1 || Math.abs(p.dy) > height * .1) throw Error('缩放须为 0.9–1.1，平移不超过图像尺寸的 10%');
  return p;
}
export function allowedMask(width, height, replacements = []) {
  const mask = new Uint8ClampedArray(width * height);
  const pad = Math.max(3, Math.round(Math.min(width, height) * .006));
  for (const r of replacements) for (const key of ['source_box', 'target_box']) {
    const b = r[key];
    if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(v) && v >= 0 && v <= 1) || b[2] <= b[0] || b[3] <= b[1]) continue;
    const x1 = Math.max(0, Math.floor(b[0] * width) - pad), y1 = Math.max(0, Math.floor(b[1] * height) - pad);
    const x2 = Math.min(width, Math.ceil(b[2] * width) + pad + 1), y2 = Math.min(height, Math.ceil(b[3] * height) + pad + 1);
    for (let y = y1; y < y2; y++) mask.fill(255, y * width + x1, y * width + x2);
  }
  return mask;
}
const median = a => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[a.length >> 1]; };
export function warp(original, raw, width, height, params, allowed) {
  const p = validateParams(params, width, height), out = new Uint8ClampedArray(original);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = x * p.sx + p.dx, yy = y * p.sy + p.dy;
    if (xx < 0 || yy < 0 || xx > width - 1 || yy > height - 1) continue;
    const x0 = Math.floor(xx), y0 = Math.floor(yy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = xx - x0, fy = yy - y0;
    for (let c = 0; c < 4; c++) out[(y * width + x) * 4 + c] = raw[(y0 * width + x0) * 4 + c] * (1 - fx) * (1 - fy) + raw[(y0 * width + x1) * 4 + c] * fx * (1 - fy) + raw[(y1 * width + x0) * 4 + c] * (1 - fx) * fy + raw[(y1 * width + x1) * 4 + c] * fx * fy;
  }
  if (p.color) {
    const samples = [[], [], []], step = Math.max(1, Math.ceil(width * height / 100000));
    for (let i = 0; i < allowed.length; i += step) {
      if (allowed[i]) continue;
      const k = i * 4;
      if (Math.max(...[0, 1, 2].map(c => Math.abs(original[k + c] - out[k + c]))) > 40) continue;
      for (let c = 0; c < 3; c++) samples[c].push(original[k + c] - out[k + c]);
    }
    if (samples[0].length > 100) {
      const offsets = samples.map(a => Math.max(-24, Math.min(24, median(a))));
      for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) out[i + c] += offsets[c];
    }
  }
  return out;
}
export function differenceMask(original, aligned, allowed, width, height) {
  const delta = new Uint8Array(allowed.length), samples = [], stride = Math.max(1, Math.ceil(allowed.length / 100000));
  for (let i = 0; i < delta.length; i++) {
    const k = i * 4;
    delta[i] = Math.max(Math.abs(original[k] - aligned[k]), Math.abs(original[k + 1] - aligned[k + 1]), Math.abs(original[k + 2] - aligned[k + 2]));
    if (!allowed[i] && i % stride === 0) samples.push(delta[i]);
  }
  const mid = median(samples), mad = median(samples.map(v => Math.abs(v - mid)));
  const threshold = Math.max(14, Math.min(64, mid + 4 * 1.4826 * mad));
  const result = new Uint8ClampedArray(delta.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!allowed[i] || delta[i] <= threshold) continue;
    let neighbors = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < width && yy >= 0 && yy < height && allowed[yy * width + xx] && delta[yy * width + xx] > threshold) neighbors++;
    }
    if (neighbors < 3) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy, j = yy * width + xx;
      if (xx >= 0 && xx < width && yy >= 0 && yy < height && allowed[j]) result[j] = 255;
    }
  }
  return result;
}
// Finite Gaussian support: effective zero means exact original RGBA.
export function featherMask(mask, width, height, radius) {
  if (!Number.isFinite(radius) || radius < 0 || radius > 20) throw Error('羽化范围必须为 0–20');
  if (!radius) return new Uint8ClampedArray(mask);
  const reach = Math.ceil(radius * 3), kernel = []; let sum = 0;
  for (let i = -reach; i <= reach; i++) { const v = Math.exp(-i * i / (2 * radius * radius)); kernel.push(v); sum += v; }
  const temp = new Float32Array(mask.length), out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 0; for (let d = -reach; d <= reach; d++) v += mask[y * width + Math.max(0, Math.min(width - 1, x + d))] * kernel[d + reach];
    temp[y * width + x] = v / sum;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 0; for (let d = -reach; d <= reach; d++) v += temp[Math.max(0, Math.min(height - 1, y + d)) * width + x] * kernel[d + reach];
    out[y * width + x] = v / sum;
  }
  return out;
}
export function mergePixels(original, aligned, effective) {
  const output = new Uint8ClampedArray(original);
  for (let i = 0; i < effective.length; i++) {
    const a = effective[i]; if (!a) continue;
    for (let c = 0; c < 4; c++) { const k = i * 4 + c; output[k] = Math.round((aligned[k] * a + original[k] * (255 - a)) / 255); }
  }
  return output;
}
// Conservative small translation search; axis scale remains manually adjustable.
export function estimateTranslation(a, b, allowed, w, h) {
  const evaluate = (dx, dy) => {
    let n = 0, aa = 0, bb = 0, ab = 0, sa = 0, sb = 0, error = 0;
    for (let y = 3; y < h - 3; y += 2) for (let x = 3; x < w - 3; x += 2) {
      const xx = x + dx, yy = y + dy;
      if (xx < 1 || xx >= w - 1 || yy < 1 || yy >= h - 1 || allowed[y * w + x] || allowed[yy * w + xx]) continue;
      const k = (y * w + x) * 4, j = (yy * w + xx) * 4;
      const va = (a[k] + a[k + 1] + a[k + 2]) / 3, vb = (b[j] + b[j + 1] + b[j + 2]) / 3;
      sa += va; sb += vb; aa += va * va; bb += vb * vb; ab += va * vb; error += Math.abs(va - vb); n++;
    }
    const denominator = Math.sqrt((aa - sa * sa / n) * (bb - sb * sb / n));
    return { score: n > 100 && denominator > 1 ? (ab - sa * sb / n) / denominator : -1, error: error / n, dx, dy };
  };
  let best = evaluate(0, 0), limit = Math.max(1, Math.round(Math.min(w, h) * .025));
  for (let dy = -limit; dy <= limit; dy++) for (let dx = -limit; dx <= limit; dx++) { const score = evaluate(dx, dy); if (score.score > best.score) best = score; }
  return { ...best, ok: best.score >= .96 && best.error < 18 };
}
