import { allowedMask, warp, differenceMask, featherMask, mergePixels, estimateTranslation } from './pixels.js';
import { encodePNG } from './png.js';
async function read(blob, width, height) {
  if (!(blob instanceof Blob) || blob.size > 80 * 1024 * 1024) throw Error('图片无效或超过 80 MB');
  const bitmap = await createImageBitmap(blob);
  const w = width || bitmap.width, h = height || bitmap.height;
  if (w * h > 16000000 || bitmap.width * bitmap.height > 40000000) { bitmap.close(); throw Error('Web 版编辑最多支持 1600 万像素（AI 原图最多 4000 万），请缩小后导入'); }
  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close();
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}
function grayPNG(gray, w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i++) { rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = gray[i]; rgba[i*4+3] = 255; }
  return encodePNG(rgba, w, h);
}
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    const original = await read(payload.original), { width: w, height: h } = original;
    const raw = await read(payload.raw, w, h), allowed = allowedMask(w, h, payload.replacements);
    let params = payload.params || { dx: 0, dy: 0, sx: 1, sy: 1, color: false }, report;
    if (type === 'prepare') {
      const factor = Math.min(1, 192 / Math.max(w, h)), sw = Math.max(16, Math.round(w * factor)), sh = Math.max(16, Math.round(h * factor));
      const [a, b] = await Promise.all([read(payload.original, sw, sh), read(payload.raw, sw, sh)]);
      report = estimateTranslation(a.data, b.data, allowedMask(sw, sh, payload.replacements), sw, sh);
      if (report.ok) params = { ...params, dx: report.dx * w / sw, dy: report.dy * h / sh };
    }
    const aligned = warp(original.data, raw.data, w, h, params, allowed);
    let mask;
    if (payload.mask) {
      const m = await read(payload.mask); if (m.width !== w || m.height !== h) throw Error('蒙版尺寸必须与原图一致');
      mask = new Uint8ClampedArray(w * h); for (let i = 0; i < mask.length; i++) mask[i] = m.data[i * 4];
    } else if (payload.auto_mask || report?.ok) mask = differenceMask(original.data, aligned, allowed, w, h);
    else mask = new Uint8ClampedArray(w * h);
    const effective = featherMask(mask, w, h, payload.feather || 0);
    const result = encodePNG(mergePixels(original.data, aligned, effective), w, h);
    self.postMessage({ id, value: { width: w, height: h, params, report, hasMask: mask.some(v => v > 0), original: encodePNG(original.data, w, h), aligned: encodePNG(aligned, w, h), mask: grayPNG(mask, w, h), effective: grayPNG(effective, w, h), result } });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
