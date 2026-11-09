import { zip, unzip } from 'fflate';
import { listJobs, putJob, withJobLock } from './storage.js';
const zipped = files => new Promise((resolve, reject) => zip(files, { level: 0 }, (e, value) => e ? reject(e) : resolve(value)));
export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function pack(value, files) {
  if (value instanceof Blob) {
    const path = `blobs/${Object.keys(files).length}.bin`; files[path] = new Uint8Array(await value.arrayBuffer());
    return { $blob: path, type: value.type };
  }
  if (Array.isArray(value)) { const out = []; for (const v of value) out.push(await pack(v, files)); return out; }
  if (value && typeof value === 'object') {
    const out = {};
    // Sequential recursion avoids duplicate file names when Blob.arrayBuffer yields.
    for (const [key, v] of Object.entries(value)) out[key] = await pack(v, files);
    return out;
  }
  return value;
}
function unpack(value, files) {
  if (value?.$blob) { if (!files[value.$blob]) throw Error('备份缺少图片数据'); return new Blob([files[value.$blob]], { type: value.type || 'application/octet-stream' }); }
  if (Array.isArray(value)) return value.map(v => unpack(v, files));
  if (value && typeof value === 'object') { const out = {}; for (const [k, v] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Error('无效的备份字段'); out[k] = unpack(v, files); } return out; }
  return value;
}
export async function exportBackup() {
  const jobs = await listJobs();
  if (jobs.some(j => ['running', 'queued'].includes(j.status))) throw Error('请等任务结束或恢复暂停任务后再备份');
  const files = {}, records = [];
  for (const job of jobs) records.push(await withJobLock(job.job_id, () => pack(job, files)));
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ format: 'localizer-v2-web', version: 1, records }));
  download(new Blob([await zipped(files)], { type: 'application/zip' }), `套图Web历史备份-${new Date().toISOString().slice(0,10)}.zip`);
  return jobs.length;
}
export async function importBackup(file) {
  if (!file || file.size > 512 * 1024 * 1024) throw Error('备份最多 512 MB，请使用本工具导出的 ZIP');
  const input = new Uint8Array(await file.arrayBuffer());
  let total = 0;
  // Reject excessive expanded sizes before allocating decompressed files.
  const files = await new Promise((resolve, reject) => unzip(input, { filter: entry => {
    total += entry.originalSize;
    if (total > 768 * 1024 * 1024 || entry.originalSize > 300 * 1024 * 1024) return false;
    return true;
  } }, (e, value) => e ? reject(e) : resolve(value)));
  if (total > 768 * 1024 * 1024) throw Error('解压数据过大，请分批备份');
  if (!files['manifest.json'] || files['manifest.json'].length > 16 * 1024 * 1024) throw Error('备份缺少有效 manifest');
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  if (manifest.format !== 'localizer-v2-web' || manifest.version !== 1 || !Array.isArray(manifest.records) || manifest.records.length > 1000) throw Error('不是 Web 版历史备份；本机 v2 的 Python 历史不能直接导入');
  const existing = new Set((await listJobs()).map(j => j.job_id));
  let count = 0, skipped = 0;
  for (const record of manifest.records) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(record.job_id) || !Array.isArray(record.images) || !Array.isArray(record.results) || !Array.isArray(record.languages)) throw Error('历史记录格式无效');
    if (existing.has(record.job_id)) { skipped++; continue; }
    const job = unpack(record, files);
    if (!job.sources || job.images.some(i => !(job.sources[i.image_id] instanceof Blob))) throw Error('备份缺少原图');
    for (const row of job.results) if (['queued','running'].includes(row.status)) { row.status = 'failed'; row.error = '导入的暂停任务，请在工作区重试续查'; }
    // Recompute progress when the record is opened; imported records are never auto-submitted.
    if (['queued','running'].includes(job.status)) job.status = 'partial';
    await withJobLock(job.job_id, () => putJob(job)); existing.add(job.job_id); count++;
  }
  return { count, skipped };
}
export async function exportResults(job, itemIds) {
  const rows = (job?.results || []).filter(r => r.status === 'completed' && r.file_url && (!itemIds || itemIds.has(r.image_id)));
  if (!rows.length) throw Error('暂无已确认的成图，请先编辑并确认待审核图片');
  const safe = value => String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, '_') || '_';
  const files = {};
  for (const row of rows) {
    const response = await fetch(row.file_url); if (!response.ok) throw Error('无法读取成图');
    const name = row.output_name || row.name || String(row.relative_path).split('/').pop();
    // Include image ID in the archive path to avoid collisions for same-named source files.
    files[`本地化结果/${safe(row.language)}/${safe(row.category)}/${safe(row.image_id)}/${safe(name)}`] = new Uint8Array(await response.arrayBuffer());
  }
  download(new Blob([await zipped(files)], { type: 'application/zip' }), `${safe(job.folder || '本地化结果')}-成图.zip`);
  return rows.length;
}
