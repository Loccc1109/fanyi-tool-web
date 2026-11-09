let worker, sequence = 0;
const waiting = new Map();
export function renderPatch(type, payload, signal) {
  if (!globalThis.Worker || !globalThis.OffscreenCanvas) return Promise.reject(Error('请使用支持 Worker 和 OffscreenCanvas 的新版 Chrome/Edge'));
  if (!worker) {
    worker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const pending = waiting.get(data.id); if (!pending) return; waiting.delete(data.id); pending.cleanup(); data.error ? pending.reject(Error(data.error)) : pending.resolve(data.value); };
    worker.onerror = () => { for (const p of waiting.values()) { p.cleanup(); p.reject(Error('图片处理线程异常，请缩小图片后重试')); } waiting.clear(); worker.terminate(); worker = null; };
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const id = ++sequence;
    const abort = () => { waiting.delete(id); reject(new DOMException('Aborted', 'AbortError')); };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    waiting.set(id, { resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, type, payload });
  });
}
