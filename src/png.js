import { zlibSync } from 'fflate';
// Encode RGBA directly, avoiding Canvas toBlob's alpha-premultiplication round trip.
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
function chunk(type, bytes) {
  const out = new Uint8Array(bytes.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, bytes.length); out.set(new TextEncoder().encode(type), 4); out.set(bytes, 8);
  let crc = 0xffffffff; for (let i = 4; i < out.length - 4; i++) crc = table[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
}
export function encodePNG(rgba, width, height) {
  const head = new Uint8Array(13), view = new DataView(head.buffer); view.setUint32(0, width); view.setUint32(4, height); head[8] = 8; head[9] = 6;
  const scan = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) scan.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', head), chunk('IDAT', zlibSync(scan, { level: 3 })), chunk('IEND', new Uint8Array())];
  return new Blob(parts, { type: 'image/png' });
}
