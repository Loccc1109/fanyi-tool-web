import { getJob, listJobs, putJob, deleteJob, withJobLock, openDB } from './storage.js';
import { publicConfig, config, saveConfig, testConfig, translate, generate, blobURL } from './remote.js';
import { renderPatch } from './render.js';

const active = new Set(), urls = new Map();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (message, status = 400) => { const e = Error(message); e.status = status; throw e; };
const base = (job, row) => `/api/patches/${job.job_id}/${encodeURIComponent(row.language)}/${row.image_id}`;
function assetURL(key, blob) {
  if (!blob) return null;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(blob));
  return urls.get(key);
}
function revokeJob(id) {
  for (const [key, value] of urls) if (key.startsWith(id + ':')) { URL.revokeObjectURL(value); urls.delete(key); }
}
export function settle(job) {
  const rows = job.results;
  job.progress = { total: rows.length, completed: rows.filter(r => ['completed', 'review'].includes(r.status)).length, failed: rows.filter(r => r.status === 'failed').length, review: rows.filter(r => r.status === 'review').length };
  if (!rows.some(r => ['running', 'queued'].includes(r.status))) job.status = job.progress.failed ? (job.progress.completed ? 'partial' : 'failed') : job.progress.review ? 'review' : 'completed';
  job.updated_at = new Date().toISOString();
}
export function publicJob(job) {
  const { sources, ...record } = job;
  return { ...record, image_count: job.images.length, results: job.results.map(row => {
    const { output, patch, ...result } = row;
    result.file_url = assetURL(`${job.job_id}:${row.image_id}:${row.language}:${row.revision || 0}`, output);
    result.edit_url = patch ? base(job, row) : null;
    result.editable = !!patch;
    return result;
  }) };
}
async function requireJob(id) { const job = await getJob(id); if (!job) fail('找不到本浏览器中的历史任务', 404); return job; }
async function recover(job) {
  if (active.has(job.job_id) || !['running', 'queued'].includes(job.status)) return job;
  // A held Web Lock means another tab is still processing this record.
  if (!navigator.locks) return job;
  return navigator.locks.request(`localizer-web:${job.job_id}`, { ifAvailable: true }, async lock => {
    if (!lock) return job;
    const fresh = await requireJob(job.job_id);
    for (const row of fresh.results) if (['running', 'queued'].includes(row.status)) { row.status = 'failed'; row.error = '页面关闭或刷新导致处理暂停。重试将续查已保存的生图任务，不会重复提交。'; }
    settle(fresh); await putJob(fresh); return fresh;
  });
}
async function prepare(job, row, image, raw) {
  // Raw paid output is saved first, so rendering failures can be retried without re-generation.
  row.patch = { raw, params: { dx: 0, dy: 0, sx: 1, sy: 1, color: false }, feather: 0 };
  await putJob(job);
  const value = await renderPatch('prepare', { original: job.sources[image.image_id], raw, replacements: row.translation.replacements });
  Object.assign(row.patch, value);
  row.status = 'review'; row.revision = 0;
  row.review_reason = value.report?.ok ? '自动平移对齐完成，仍请逐一确认营销文字和产品边界。' : '自动对齐可信度不足，已留空蒙版；请手动校正后框选或绘制。';
  if (!value.hasMask && value.report?.ok) row.review_reason = '未检出可信的文字差异区域，请手动绘制并核对原文是否清除。';
  row.output = value.result;
  row.output_name = `${image.name.replace(/\.[^.]+$/, '')}-${image.image_id.slice(0, 8)}-r0.png`;
}
async function run(id) {
  active.add(id);
  try {
    await withJobLock(id, async () => {
      const job = await requireJob(id), cfg = config();
      job.status = 'running'; job.error = ''; settle(job); await putJob(job);
      const persist = async () => { settle(job); await putJob(job); };
      for (const language of job.languages) {
        const pending = job.results.filter(r => r.language === language && ['queued', 'failed'].includes(r.status));
        const missing = pending.filter(r => !r.translation);
        if (missing.length) {
          try {
            const images = job.images.filter(i => missing.some(r => r.image_id === i.image_id));
            // Small batches keep multimodal request sizes manageable.
            for (let i = 0; i < images.length; i += 4) {
              const batch = images.slice(i, i + 4), translations = await translate(batch, language, job.sources, cfg.translation);
              for (const row of missing.filter(r => batch.some(i => i.image_id === r.image_id))) {
                if (!translations[row.image_id]) { row.status = 'failed'; row.error = '翻译回复遗漏此图片，请重试'; }
                else { row.translation = translations[row.image_id]; row.status = 'queued'; row.error = ''; }
              }
              await persist();
            }
          } catch (error) {
            for (const row of missing.filter(r => !r.translation)) { row.status = 'failed'; row.error = error.message; }
            await persist();
          }
        }
        const queue = pending.filter(r => r.translation && r.status !== 'completed');
        let index = 0;
        const worker = async () => {
          while (index < queue.length) {
            const row = queue[index++], image = job.images.find(i => i.image_id === row.image_id);
            row.status = 'running'; row.error = ''; await persist();
            try {
              if (!row.translation.replacements.length) {
                row.output = job.sources[row.image_id]; row.output_name = image.name; row.status = 'completed';
              } else if (row.patch?.raw) {
                await prepare(job, row, image, row.patch.raw);
              } else {
                const raw = await generate(row, image, job.sources[row.image_id], cfg.generation, persist);
                await prepare(job, row, image, raw);
              }
            } catch (error) { row.status = 'failed'; row.error = error.message; }
            await persist();
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(cfg.generation.concurrency) || 2)) }, worker));
      }
      settle(job); await putJob(job);
    });
  } catch (error) {
    // Do not overwrite another tab's record when lock acquisition fails.
    console.error('Browser job paused:', error.message);
  } finally { active.delete(id); }
}
export async function createJob(form) {
  const manifest = JSON.parse(form.get('manifest'));
  if (!Array.isArray(manifest.images) || !manifest.images.length || manifest.images.length > 100 || !Array.isArray(manifest.languages) || !manifest.languages.length) fail('每次请选择 1–100 张图片和目标语言');
  const languages = [...new Set(manifest.languages)];
  if (languages.some(l => !['德语', '意大利语', '法语', '西班牙语'].includes(l))) fail('目标语言无效');
  const cfg = config();
  for (const s of ['translation', 'generation']) if (!cfg[s].api_url || !cfg[s].api_key || !cfg[s].model) fail('请先补全 API 设置');
  const sources = {}, images = [];
  let bytes = 0;
  for (const input of manifest.images) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.id) || sources[input.id]) fail('图片 ID 无效或重复');
    const blob = form.getAll('files').find(f => f.name === `file_${input.id}`);
    if (!(blob instanceof Blob) || !blob.size || blob.size > 80 * 1024 * 1024) fail('原图为空或超过 80 MB');
    if (!(input.width > 0 && input.height > 0 && input.width * input.height <= 16000000)) fail('Web 版每图最多支持 1600 万像素');
    if (!['main','desktop','mobile','brand'].includes(input.category)) fail('请先确认图片分类');
    bytes += blob.size; if (bytes > 300 * 1024 * 1024) fail('单批原图最多 300 MB，请分批处理');
    sources[input.id] = blob;
    images.push({ image_id: input.id, name: input.name, relative_path: input.relative_path, category: input.category, width: input.width, height: input.height });
  }
  const now = new Date().toISOString(), job = { job_id: crypto.randomUUID(), created_at: now, updated_at: now, folder: String(manifest.folder || ''), status: 'queued', languages, images, sources, results: [] };
  for (const language of languages) for (const image of images) job.results.push({ ...image, language, status: 'queued', revision: 0, translation: null, error: '' });
  settle(job); await putJob(job); void run(job.job_id); return publicJob(job);
}
async function parseBody(init) { return typeof init.body === 'string' ? JSON.parse(init.body) : init.body || {}; }
async function maskBlob(value) {
  if (typeof value !== 'string' || value.length > 64000000 || !value.startsWith('data:image/png;base64,')) fail('蒙版必须是 PNG，且不能超过 48 MB');
  return (await globalThis.fetch(value)).blob();
}
async function route(path, init) {
  const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent), method = (init.method || 'GET').toUpperCase();
  if (path === '/api/health') { await openDB(); return json({ ok: true, mode: 'static-web' }); }
  if (path === '/api/config') { await openDB(); return json(method === 'PUT' ? saveConfig(await parseBody(init)) : publicConfig()); }
  if (path === '/api/config/test') return json(await testConfig());
  if (path === '/api/jobs' && method === 'POST') return json(await createJob(init.body));
  if (path === '/api/history') {
    const records = await listJobs();
    if (method === 'DELETE') {
      for (const record of records) await withJobLock(record.job_id, async () => { await deleteJob(record.job_id); revokeJob(record.job_id); });
      return json({ deleted: records.length });
    }
    const summaries = [];
    for (const record of records) {
      const job = await recover(record);
      summaries.push({ job_id: job.job_id, folder: job.folder, status: job.status, languages: job.languages, created_at: job.created_at, image_count: job.images.length, progress: job.progress });
    }
    return json({ records: summaries.sort((a,b) => b.created_at.localeCompare(a.created_at)) });
  }
  if (['history', 'jobs'].includes(parts[1])) {
    const id = parts[2]; let job = await requireJob(id);
    if (parts.length === 3) {
      if (method === 'DELETE') { await withJobLock(id, async () => { await deleteJob(id); revokeJob(id); }); return json({ deleted: 1 }); }
      job = await recover(job); return json(publicJob(job));
    }
    if (parts[3] === 'sources') { const blob = job.sources[parts[4]]; if (!blob) fail('此记录缺少原图',404); return new Response(blob); }
    if (parts[3] === 'resume' && method === 'POST') {
      return withJobLock(id, async () => {
        job = await requireJob(id);
        const data = await parseBody(init), row = job.results.find(r => r.image_id === data.image_id && r.language === data.language);
        if (!row?.task?.uncertain || typeof data.task_id !== 'string' || !/^[\w-]{1,200}$/.test(data.task_id)) fail('任务 ID 无效，或此项不需要手动接续');
        row.task.id = data.task_id; row.task.uncertain = false; await putJob(job); return json({ ok: true });
      });
    }
    if (parts[3] === 'retry' && method === 'POST') {
      await withJobLock(id, async () => {
        job = await requireJob(id);
        if (!job.results.some(r => r.status === 'failed')) fail('没有失败项可重试');
        job.results.forEach(r => { if (r.status === 'failed') { r.status = 'queued'; r.error = ''; } });
        job.status = 'queued'; settle(job); await putJob(job);
      });
      void run(id); return json(publicJob(job));
    }
  }
  if (parts[1] === 'patches') {
    const [, , id, language, imageId] = parts;
    const job = await requireJob(id), row = job.results.find(r => r.language === language && r.image_id === imageId);
    if (!row?.patch?.original) fail('本项暂无完整的编辑素材，请先重试图像处理', 404);
    const patch = row.patch;
    if (parts[5] === 'assets') {
      const name = parts[6]?.replace('.png', ''), blob = ({ original: patch.original, aligned: patch.aligned, mask: patch.mask, result: row.output, raw_ai: patch.raw, effective: patch.effective })[name];
      if (!blob) fail('素材不存在',404); return new Response(blob);
    }
    if (method === 'GET') return json({ width: patch.width, height: patch.height, settings: { params: patch.params, feather: patch.feather, alignment: patch.report }, row: publicJob(job).results.find(r => r.image_id === imageId && r.language === language) });
    const data = await parseBody(init);
    const payload = { original: patch.original, raw: patch.raw, replacements: row.translation.replacements, params: data.params, feather: data.feather ?? 0, mask: data.mask ? await maskBlob(data.mask) : undefined, auto_mask: !!data.auto_mask };
    if (parts[5] === 'preview' && method === 'POST') {
      const value = await renderPatch('preview', payload, init.signal);
      return json({ aligned: await blobURL(value.aligned), mask: await blobURL(value.mask), result: await blobURL(value.result) });
    }
    if (method === 'PUT') return withJobLock(id, async () => {
      const fresh = await requireJob(id), target = fresh.results.find(r => r.image_id === imageId && r.language === language);
      if (data.revision !== (target.revision || 0)) fail('此结果已在其他窗口更新，请关闭并重新打开', 409);
      if (!payload.mask) fail('缺少编辑蒙版');
      const value = await renderPatch('save', payload, init.signal);
      if (data.confirm && !value.hasMask) fail('请先绘制有效蒙版；空蒙版只能保存为待确认草稿');
      target.patch = { ...target.patch, ...value, feather: payload.feather };
      target.output = value.result; target.revision = (target.revision || 0) + 1; target.status = data.confirm ? 'completed' : 'review'; target.review_reason = data.confirm ? '' : '手工草稿待确认';
      target.output_name = `${target.name.replace(/\.[^.]+$/, '')}-${target.image_id.slice(0,8)}-r${target.revision}.png`;
      settle(fresh); await putJob(fresh);
      const pub = publicJob(fresh); return json({ row: pub.results.find(r => r.image_id === imageId && r.language === language), job: pub });
    });
  }
  fail('浏览器本地接口不存在', 404);
}
export async function localFetch(input, init = {}) {
  const path = String(input);
  if (!path.startsWith('/api/')) return globalThis.fetch(input, init);
  try { if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError'); return await route(path, init); }
  catch (error) { if (error.name === 'AbortError') throw error; return json({ detail: error.message || String(error) }, error.status || 400); }
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => { if (active.size) { event.preventDefault(); event.returnValue = ''; } });
