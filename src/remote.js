const DEFAULTS = {
  translation: { api_url: '', api_key: '', model: '' },
  generation: { api_url: '', api_key: '', model: 'nano-banana-2', image_size: '2K', concurrency: 2, poll_interval: 2, timeout_seconds: 600 },
};
const SETTINGS = 'localizer-web-settings', KEYS = 'localizer-web-keys';
let keys = {};
try { keys = JSON.parse(sessionStorage.getItem(KEYS) || '{}'); } catch { /* New session. */ }
export function config() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS) || '{}'); } catch { /* Use defaults. */ }
  const result = { remember_keys: !!saved.remember_keys };
  for (const section of ['translation', 'generation']) result[section] = { ...DEFAULTS[section], ...saved[section], api_key: keys[section] || (saved.remember_keys ? saved[section]?.api_key : '') || '' };
  return result;
}
export function publicConfig() {
  const result = config();
  for (const s of ['translation', 'generation']) { result[s].api_key_set = !!result[s].api_key; delete result[s].api_key; }
  return result;
}
export function saveConfig(input) {
  const current = config();
  for (const s of ['translation', 'generation']) {
    for (const key of Object.keys(DEFAULTS[s])) if (key in (input[s] || {}) && (key !== 'api_key' || String(input[s][key] || '').trim())) current[s][key] = input[s][key];
    if (input[s]?.clear_key) current[s].api_key = '';
    keys[s] = String(current[s].api_key || '').trim();
  }
  current.remember_keys = !!input.remember_keys;
  const persisted = structuredClone(current);
  if (!current.remember_keys) for (const s of ['translation', 'generation']) persisted[s].api_key = '';
  localStorage.setItem(SETTINGS, JSON.stringify(persisted));
  sessionStorage.setItem(KEYS, JSON.stringify(keys));
  return publicConfig();
}
export function endpoint(value, kind) {
  value = String(value || '').trim().replace(/\/+$/, '');
  if (!value) throw Error('请先配置 API 地址');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw Error('API 须为 HTTPS 地址（本机调试可用 HTTP），不可带查询参数或账号密码');
  const suffix = kind === 'translation' ? '/chat/completions' : '/tasks';
  if (value.endsWith(suffix)) return value;
  return value + (value.endsWith('/v1') ? suffix : '/v1' + suffix);
}
export async function request(url, { key, payload, method = 'GET', timeout = 120000, headers = {}, json = true } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await globalThis.fetch(url, {
      method, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
    if (!json) return response.blob();
    const data = await response.json();
    if (data?.success === false || (data?.code !== undefined && /^\d+$/.test(String(data.code)) && ![0, 200].includes(Number(data.code)))) throw Error(String(data.message || data.error || 'API 返回失败状态'));
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw Error('API 请求超时；提交可能已被接收，请勿立即重复生图');
    if (e instanceof TypeError) throw Error('浏览器无法读取远程服务：请检查网络、HTTPS 和 CORS（包括 Authorization/Content-Type/Idempotency-Key 预检及成图下载域名）；纯静态网页不能绕过 CORS');
    throw e;
  } finally { clearTimeout(timer); }
}
export const blobURL = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
const TRANSLATE = `Translate only independent, editable marketing copy overlaid in this product image set into TARGET_LANGUAGE.
Never translate or modify physical product/packaging/labels/logos/manuals/tags/accessory text. Leave uncertain text alone. Preserve brand names, numbers, dimensions and model IDs.
Return valid JSON only: {"translation_results":[{"image_id":"exact IMAGE_ID","replacements":[{"source_text":"...","translated_text":"...","source_box":[0.1,0.1,0.4,0.2],"target_box":[0.1,0.1,0.5,0.2]}],"image_edit_prompt":"..."}]}.
Return each IMAGE_ID exactly once. Boxes are normalized [left,top,right,bottom] in the EXIF-oriented image. Omit boxes if uncertain. Leave room for target text without including product surfaces. Use empty replacements if no editable text.`;
export async function translate(images, language, sources, cfg) {
  const content = [{ type: 'text', text: TRANSLATE.replace('TARGET_LANGUAGE', language) }];
  for (const image of images) {
    content.push({ type: 'text', text: `IMAGE_ID: ${image.image_id}` });
    content.push({ type: 'image_url', image_url: { url: await blobURL(sources[image.image_id]) } });
  }
  const response = await request(endpoint(cfg.api_url, 'translation'), { key: cfg.api_key, payload: { model: cfg.model, temperature: .1, messages: [{ role: 'user', content }] }, method: 'POST', timeout: 300000 });
  let text = response?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) text = text.map(p => p.text || '').join('');
  if (typeof text !== 'string') throw Error('翻译 API 不是 OpenAI 兼容 chat/completions 格式');
  const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(parsed.translation_results)) throw Error('翻译回复缺少 translation_results');
  return Object.fromEntries(parsed.translation_results.filter(r => r && typeof r.image_id === 'string').map(r => {
    const replacements = (Array.isArray(r.replacements) ? r.replacements : []).filter(p => typeof p?.source_text === 'string' && p.source_text.trim() && typeof p.translated_text === 'string' && p.translated_text.trim()).map(p => ({ source_text: p.source_text.trim(), translated_text: p.translated_text.trim(), source_box: p.source_box, target_box: p.target_box }));
    return [r.image_id, { replacements, source_text: replacements.map(p => p.source_text).join('\n'), translated_text: replacements.map(p => p.translated_text).join('\n'), edit_prompt: replacements.map(p => `"${p.source_text}"替换为"${p.translated_text}"`).join('\n') }];
  }));
}
export function findTaskId(response) {
  for (const value of [response?.data, response]) for (const key of ['id', 'taskId', 'task_id']) if (value?.[key]) return String(value[key]);
  throw Error('提交后没有任务 ID，请到供应商后台核对，避免重复付费');
}
function imageURLs(value) {
  if (Array.isArray(value)) return value.flatMap(imageURLs);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, v]) => /^(url|image_?url|download_?url)$/i.test(key) && typeof v === 'string' && /^https:\/\//.test(v) ? [v] : imageURLs(v));
}
export async function generate(row, image, source, cfg, persist) {
  const target = endpoint(cfg.api_url, 'generation');
  if (row.task && row.task.endpoint !== target) throw Error('此项已有生图任务，请恢复原 API 地址后续查，避免重复付费');
  if (!row.task?.id) {
    if (row.task?.uncertain) throw Error('上次提交结果不确定，请先在供应商后台查到任务 ID 并填入“接续任务”，不要盲目重新生成');
    row.task = { endpoint: target, idempotency: crypto.randomUUID(), uncertain: true };
    await persist(); // Persist intent before paid submission.
    const result = await request(target, { key: cfg.api_key, method: 'POST', headers: { 'Idempotency-Key': row.task.idempotency }, payload: {
      kind: 'image', model: cfg.model, operation: 'generate', input: { prompt: `Strict local marketing text replacement. Keep all other pixels identical. Never modify physical products, packaging, logos, numbers or unlisted text.\nRequired replacements:\n${row.translation.edit_prompt}`, image: await blobURL(source), size: ({ desktop: '21:9', mobile: '4:3', brand: 'auto' })[image.category] || '1:1', resolution: String(cfg.image_size || '2K').toLowerCase(), n: 1, response_format: 'url' },
    } });
    row.task.id = findTaskId(result); row.task.uncertain = false; await persist();
  }
  const start = Date.now(), timeout = Math.max(30, Number(cfg.timeout_seconds) || 600) * 1000;
  while (Date.now() - start < timeout) {
    const result = await request(`${target}/${encodeURIComponent(row.task.id)}`, { key: cfg.api_key });
    const data = result.data && typeof result.data === 'object' ? result.data : result;
    const status = String(data.status || data.state || data.taskStatus || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done'].includes(status)) {
      const urls = Array.isArray(data.result_urls) ? data.result_urls : imageURLs(result);
      if (!urls.length || typeof urls[0] !== 'string' || !urls[0].startsWith('https://')) throw Error('任务成功但缺少 HTTPS 成图 URL');
      // No Authorization header is ever forwarded to image download hosts.
      return request(urls[0], { json: false, timeout: 180000 });
    }
    if (['failed', 'failure', 'error', 'violation', 'cancelled'].includes(status)) throw Error(String(data.error_message || data.message || data.error || '生图任务失败（保留任务 ID，不自动重扣费用）'));
    if (!['pending', 'queued', 'running', 'processing', 'submitted'].includes(status)) throw Error(`未知生图任务状态：${status || '空'}`);
    await new Promise(r => setTimeout(r, Math.max(1, Number(cfg.poll_interval) || 2) * 1000));
  }
  throw Error('生图等待超时，任务 ID 已保存；重试只续查原任务，不重新提交');
}
export async function testConfig() {
  const cfg = config(), checks = {};
  for (const s of ['translation', 'generation']) {
    const section = cfg[s], ready = !!(section.api_url && section.api_key && section.model);
    if (!ready) { checks[s] = { ready, reachable: false, message: '请补全地址、Key 和模型' }; continue; }
    const start = performance.now();
    try {
      const response = await globalThis.fetch(endpoint(section.api_url, s), { headers: { Authorization: `Bearer ${section.api_key}` }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) });
      checks[s] = { ready, reachable: true, latency_ms: Math.round(performance.now() - start), message: `浏览器可读取响应（HTTP ${response.status}）；GET 探测不代表 POST/生图下载一定可用` };
    } catch { checks[s] = { ready, reachable: false, message: '网络、HTTPS 或 CORS 不允许浏览器读取；测试不会提交付费任务' }; }
  }
  return { checks };
}
