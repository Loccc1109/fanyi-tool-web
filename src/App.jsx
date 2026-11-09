import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localFetch as fetch } from './local-api.js';
import { exportBackup, importBackup, exportResults } from './backup.js';

const LANGUAGES = [
  { id: '德语', short: 'DE', native: 'Deutsch' },
  { id: '意大利语', short: 'IT', native: 'Italiano' },
  { id: '法语', short: 'FR', native: 'Français' },
  { id: '西班牙语', short: 'ES', native: 'Español' },
];
const GROUPS = [
  { id: 'main', title: '主图', folder: '主图', ratio: '1:1', target: 1, shape: 'square' },
  { id: 'desktop', title: 'A+ PC 端图', folder: 'A+PC端', ratio: '21:9', target: 21 / 9, shape: 'wide' },
  { id: 'mobile', title: 'A+ 手机端图', folder: 'A+手机端', ratio: '4:3', target: 4 / 3, shape: 'landscape' },
  { id: 'brand', title: '品牌故事图', folder: '品牌故事', ratio: '1464×625 / 463×625', target: null, shape: 'brand' },
  { id: 'review', title: '待确认', folder: '待确认', ratio: '尺寸待确认', target: null, shape: 'landscape' },
];
const ACCEPTED = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp']);
import PatchEditor from './PatchEditor.jsx';

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    folder: <><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M3.5 9h17"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
    language: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m7 10 5 5 5-5"/>,
    close: <path d="m18 6-12 12M6 6l12 12"/>,
    trash: <><path d="M4 7h16"/><path d="M10 11v6m4-6v6"/><path d="m9 7 .7-2h4.6l.7 2M6 7l.8 13h10.4L18 7"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2.9-1.2 2.1-1.4-.5a7.6 7.6 0 0 1-1.5.9l-.2 1.5h-2.4l-.2-1.5a7.6 7.6 0 0 1-1.5-.9l-1.4.5-1.2-2.1 1.2-.9a7.5 7.5 0 0 1 0-1.8l-1.2-.9 1.2-2.1 1.4.5a7.6 7.6 0 0 1 1.5-.9l.2-1.5h2.4l.2 1.5a7.6 7.6 0 0 1 1.5.9l1.4-.5 1.2 2.1-1.2.9a7.5 7.5 0 0 1 0 1.7Z" transform="translate(-1 -1)"/></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
    sparkle: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></>,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    stack: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    terminal: <><path d="m4 5 6 6-6 6"/><path d="M13 17h7"/></>,
  };
  return <svg {...common}>{paths[name] || null}</svg>;
}

function ratioFor(width, height) {
  if (!width || !height) return null;
  const ratio = width / height;
  const candidates = GROUPS.slice(0, 3).map((group) => ({ group, distance: Math.abs(ratio - group.target) / group.target }));
  candidates.sort((a, b) => a.distance - b.distance);
  if (candidates[0].distance > 0.2 || (candidates[1] && candidates[1].distance - candidates[0].distance < 0.045)) return null;
  return candidates[0].group.id;
}

const BRAND_SIZES = [[1464, 625], [463, 625]];

function brandSizeFor(width, height) {
  if (!width || !height) return null;
  return BRAND_SIZES.some(([targetWidth, targetHeight]) => width === targetWidth && height === targetHeight) ? 'brand' : null;
}

async function dimensionsOf(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return { width: 0, height: 0 };
  }
}

function imageEntriesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entryRoots = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entryRoots.length) return Promise.resolve([...dataTransfer.files].map((file) => ({ file, relativePath: file.name })));
  const files = [];
  const walk = (entry, prefix = '') => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => { files.push({ file, relativePath: prefix + file.name }); resolve(); }, resolve);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const read = () => reader.readEntries(async (entries) => {
        if (!entries.length) return resolve();
        await Promise.all(entries.map((child) => walk(child, prefix + entry.name + '/')));
        read();
      }, resolve);
      read();
      return;
    }
    resolve();
  });
  return Promise.all(entryRoots.map((entry) => walk(entry))).then(() => files);
}

function imageEntriesFromPicker(fileList) {
  return [...fileList].map((file) => ({ file, relativePath: file.webkitRelativePath || file.name }));
}

function classifyEntries(entries) {
  return entries.filter(({ file }) => ACCEPTED.has(file.name.split('.').pop().toLowerCase())).map(async ({ file, relativePath }) => {
    const { width, height } = await dimensionsOf(file);
    const category = brandSizeFor(width, height) || ratioFor(width, height) || 'review';
    return { id: crypto.randomUUID(), file, relativePath, name: file.name, width, height, category, preview: URL.createObjectURL(file) };
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Topbar({ onSettings, onHistory, backendOnline, developerMode, onToggleDeveloperMode }) {
  return <header className="topbar">
    <a className="brand" href="#top" aria-label="套图本地化工作台首页">
      <span className="brand-mark"><span /><span /><span /></span>
      <span className="brand-name">套图本地化<span>工作台</span></span>
    </a>
    <div className="topbar-right">
      <span className={`service-status ${backendOnline ? 'is-online' : ''}`}><i />{backendOnline ? '静态 Web 已就绪' : '浏览器存储不可用'}</span>
      <button className={`icon-button ${developerMode ? 'is-active' : ''}`} type="button" onClick={onToggleDeveloperMode} aria-pressed={developerMode} aria-label="开发者模式" title={developerMode ? '开发者模式已开启：显示运行日志' : '开启开发者模式：显示运行日志'}><Icon name="terminal" /></button>
      <button className="icon-button" type="button" onClick={onHistory} aria-label="历史记录" title="历史记录"><Icon name="clock" /></button>
      <button className="icon-button" type="button" onClick={onSettings} aria-label="API 设置" title="API 设置"><Icon name="settings" /></button>
    </div>
  </header>;
}

function FolderPicker({ items, folderName, directoryAuthorized, onEntries, onFolderHandle }) {
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef(null);
  const acceptDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const entries = await imageEntriesFromDrop(event.dataTransfer);
    const rootName = entries[0]?.relativePath.split('/')[0] || '拖入的商品文件夹';
    await onEntries(entries, rootName);
  };
  const onFolderChange = async (event) => {
    const entries = imageEntriesFromPicker(event.target.files || []);
    const name = entries[0]?.relativePath.split('/')[0] || '已选商品文件夹';
    await onEntries(entries, name);
    event.target.value = '';
  };
  const chooseAuthorizedFolder = async () => {
    if (!window.showDirectoryPicker) {
      folderInput.current?.click();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await onFolderHandle(handle);
      setDragging(false);
    } catch (error) {
      if (error.name !== 'AbortError') console.error(error);
    }
  };
  return <section className="source-panel" aria-label="商品文件夹">
    <div className="panel-title-row"><h2>商品文件夹</h2><span className="step-note">导入套图</span></div>
    <input ref={folderInput} className="visually-hidden" type="file" webkitdirectory="" directory="" multiple onChange={onFolderChange} aria-label="选择商品文件夹" />
    <div
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${items.length ? 'has-items' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={acceptDrop}
    >
      {items.length ? <>
        <span className="drop-icon filled"><Icon name="folder" size={20} /></span>
        <strong className="folder-name" title={folderName}>{folderName}</strong>
        <span className="drop-caption">已读取 {items.length} 张图片</span>
        <button type="button" className="text-button" onClick={() => folderInput.current?.click()}>更换文件夹</button>
      </> : <>
        <span className="drop-icon"><Icon name="upload" size={21} /></span>
        <strong>把商品文件夹拖到这里</strong>
        <span className="drop-caption">递归读取子文件夹中的图片</span>
        <button type="button" className="button button-quiet button-small" onClick={() => folderInput.current?.click()}>浏览文件夹</button>
      </>}
      <span className="supported-types">JPG · PNG · WEBP · BMP</span>
    </div>
    <button className={`folder-access ${directoryAuthorized ? 'access-ready' : ''}`} type="button" onClick={chooseAuthorizedFolder}>
      <Icon name={directoryAuthorized ? 'check' : 'folder'} size={16} />
      <span>{directoryAuthorized ? '已授权此文件夹' : items.length ? '授权输出到此文件夹' : '选择并授权文件夹读写'}</span>
      <Icon name="arrow" size={15} />
    </button>
    <p className="folder-access-note">可授权写入文件夹；也可直接下载成图 ZIP。</p>
  </section>;
}

function LanguagePicker({ selected, onToggle, disabled }) {
  return <section className="language-panel" aria-label="目标语言">
    <div className="panel-title-row"><h2>输出语言</h2><span className="step-note">可多选</span></div>
    <div className="language-list">
      {LANGUAGES.map((language) => {
        const active = selected.includes(language.id);
        return <button type="button" key={language.id} className={`language-option ${active ? 'selected' : ''}`} onClick={() => onToggle(language.id)} disabled={disabled} aria-pressed={active}>
          <span className="language-check">{active && <Icon name="check" size={13} strokeWidth={2.4} />}</span>
          <span className="language-title">{language.id}<small>{language.native}</small></span>
          <span className="language-code">{language.short}</span>
        </button>;
      })}
    </div>
  </section>;
}

function ProcessPanel({ itemCount, reviewCount, selectedCount, selectedLanguages, job, busy, onStart, onRetry, onWrite }) {
  const progress = job?.progress;
  const percentage = progress?.total ? Math.min(100, Math.round((progress.completed + progress.failed) / progress.total * 100)) : 0;
  const complete = job?.status === 'completed' || job?.status === 'partial' || job?.status === 'review';
  return <section className="process-panel">
    {job ? <>
      <div className="process-head"><div><span className="step-note">处理进度</span><h2>{job.status === 'partial' ? '部分图片待重试' : job.status === 'review' ? '图片待确认后保存' : complete ? '本地化已完成' : '正在处理套图'}</h2></div><span className="progress-number">{percentage}<small>%</small></span></div>
      <div className="progress-track"><span style={{ width: `${percentage}%` }} /></div>
      <div className="progress-meta"><span>{progress?.completed || 0} / {progress?.total || 0} 张完成</span><span>{progress?.failed ? `${progress.failed} 张失败` : complete ? '可以查看结果' : '保持页面开启'}</span></div>
      <div className="job-status-line"><i className={complete ? 'done' : ''} />{job.status === 'partial' ? `${progress?.failed || 0} 张失败，可重试` : job.status === 'review' ? `${progress?.review || 0} 张待确认；请在图片卡片中编辑并确认` : complete ? `已处理 ${selectedLanguages.length} 种语言` : job.status === 'failed' ? '任务遇到问题' : '翻译与图片生成中'}</div>
      {complete && <button type="button" className="button button-primary full-button" disabled={busy} onClick={onWrite}><Icon name="download" size={17} />保存结果 / 下载 ZIP</button>}
      {(job.status === 'failed' || job.status === 'partial') && <button type="button" className="button button-quiet full-button" disabled={busy} onClick={onRetry}><Icon name="refresh" size={16} />重试失败项</button>}
      {!['queued', 'running'].includes(job.status) && <button type="button" className="button button-quiet full-button" disabled={busy || !itemCount || reviewCount > 0 || !selectedLanguages.length} onClick={onStart}><Icon name="sparkle" size={16} />按当前设置重新生成</button>}
    </> : <>
      <div className="process-head"><div><span className="step-note">准备处理</span><h2>本地化套图</h2></div><span className="process-sparkle"><Icon name="sparkle" size={20} /></span></div>
      <p className="process-copy">自动提取可编辑的营销文案，生成译文并替换到图片中。</p>
      <div className="batch-summary"><span><Icon name="image" size={16} />{itemCount} 张图片</span><span><Icon name="language" size={16} />{selectedLanguages.length} 种语言</span></div>
      <button type="button" className="button button-primary full-button" disabled={busy || !itemCount || reviewCount > 0 || !selectedCount || !selectedLanguages.length} onClick={onStart}>
        {busy ? <><span className="spinner" />正在整理图片</> : <>开始自动本地化<Icon name="arrow" size={17} /></>}
      </button>
      {reviewCount > 0 ? <p className="form-hint">请先确认 {reviewCount} 张图片的类型。</p> : !selectedLanguages.length && <p className="form-hint">选择至少一种目标语言后开始。</p>}
    </>}
  </section>;
}

function DeveloperLogs({ logs, onClear }) {
  return <section className="developer-logs" aria-label="运行日志">
    <div className="developer-logs-head"><span><Icon name="terminal" size={14} />运行日志</span><button type="button" onClick={onClear}>清空</button></div>
    <div className="developer-logs-body">{logs.length ? logs.map((entry) => <div className={`log-entry log-${entry.level}`} key={entry.id}><time>{entry.time}</time><span>{entry.message}</span></div>) : <div className="log-empty">开始测试或自动化后，运行信息会显示在这里。</div>}</div>
  </section>;
}

function Sidebar({ items, reviewCount, folderName, directoryAuthorized, selectedLanguages, onToggleLanguage, busy, job, onStart, onRetry, onWrite, onEntries, onFolderHandle, developerMode, logs, onClearLogs }) {
  return <aside className="sidebar">
    <FolderPicker items={items} folderName={folderName} directoryAuthorized={directoryAuthorized} onEntries={onEntries} onFolderHandle={onFolderHandle} />
    <LanguagePicker selected={selectedLanguages} onToggle={onToggleLanguage} disabled={busy} />
    <ProcessPanel itemCount={items.length} reviewCount={reviewCount} selectedCount={selectedLanguages.length} selectedLanguages={selectedLanguages} job={job} busy={busy} onStart={onStart} onRetry={onRetry} onWrite={onWrite} />
    {developerMode && <DeveloperLogs logs={logs} onClear={onClearLogs} />}
    <div className="safety-note"><Icon name="check" size={15} /><span>产品与包装上的原有文字会保留，不参与翻译。</span></div>
  </aside>;
}

function CategoryTabs({ counts, active, onSelect }) {
  return <div className="category-tabs" role="tablist" aria-label="按图片类型筛选">
    {GROUPS.map((group) => <button key={group.id} role="tab" aria-selected={active === group.id} className={`category-tab ${active === group.id ? 'active' : ''}`} onClick={() => onSelect(group.id)}>
      <span>{group.title}</span><small>{group.ratio}</small><b>{counts[group.id] || 0}</b>
    </button>)}
  </div>;
}

function TranslationView({ result, image }) {
  if (!result) return <div className="translation-empty"><span className="translation-dot" />尚未开始本地化</div>;
  const data = result.translation || {};
  return <div className="translation-view">
    <div className="translation-copy">
      <span>原文与译文</span>
      {data.source_text || data.translated_text ? <><p>{data.source_text || '未识别到可替换文案'}</p><p className="translated-text">{data.translated_text}</p></> : <p className="translation-note">{result.status === 'failed' ? result.error || '处理失败' : '这张图片无需替换文字'}</p>}
    </div>
    {result.file_url ? <a className="result-link" href={result.file_url} target="_blank" rel="noreferrer">预览成图<Icon name="arrow" size={14} /></a> : <span className={`result-state ${result.status === 'failed' ? 'failed' : ''}`}>{result.status === 'failed' ? '失败' : result.status === 'completed' ? '原图保留' : '处理中'}</span>}
  </div>;
}

function ImageTile({ item, selectedLanguages, jobResults, activeLanguage, onLanguageSelect, onMove, onDelete, onEdit, busy }) {
  const [viewingResult, setViewingResult] = useState(false);
  const group = GROUPS.find((entry) => entry.id === item.category);
  const stageShape = item.category === 'brand' ? (item.width / item.height >= 2 ? 'brand-large' : 'brand-small') : (group?.shape || 'landscape');
  const languages = selectedLanguages.length ? selectedLanguages : [];
  const currentLanguage = activeLanguage && languages.includes(activeLanguage) ? activeLanguage : languages[0];
  const result = currentLanguage ? jobResults[`${item.id}:${currentLanguage}`] : null;
  const showResult = viewingResult && result?.file_url;
  return <article className="image-tile">
    <div className={`image-stage stage-${stageShape}`}>
      <img src={showResult ? result.file_url : item.preview} alt={`${showResult ? `${currentLanguage} 本地化结果` : '原图'} ${item.name}`} loading="lazy" />
      <span className="image-type-pill">{showResult ? `${LANGUAGES.find((entry) => entry.id === currentLanguage)?.short || ''} 成图` : `${item.width} × ${item.height}`}</span>
      {result?.file_url && <div className="image-view-toggle"><button type="button" className={!showResult ? 'selected' : ''} onClick={() => setViewingResult(false)}>原图</button><button type="button" className={showResult ? 'selected' : ''} onClick={() => setViewingResult(true)}>{LANGUAGES.find((entry) => entry.id === currentLanguage)?.short || '译文'}</button></div>}
      {item.category === 'review' && <button type="button" className="review-pill" onClick={() => onMove(item.id, 'main')} disabled={busy}><Icon name="alert" size={13} />调整类型<Icon name="chevron" size={13} /></button>}
    </div>
    <div className="tile-caption"><strong title={item.name}>{item.name}</strong><div className="tile-caption-meta"><span>{formatBytes(item.file.size)}</span><button type="button" className="delete-image-button" onClick={() => onDelete(item)} disabled={busy} aria-label={`删除 ${item.name}`} title="从套图清单删除"><Icon name="trash" size={14} /></button></div></div>
    <div className={`move-select ${item.category === 'review' ? '' : 'move-quiet'}`}><label htmlFor={`move-${item.id}`}>图片类型</label><select id={`move-${item.id}`} value={item.category} onChange={(event) => onMove(item.id, event.target.value)} disabled={busy}>{GROUPS.map((option) => <option key={option.id} value={option.id}>{option.title} · {option.ratio}</option>)}</select></div>
    {languages.length > 0 && <div className="tile-results">
      {languages.length > 1 && <div className="tile-language-tabs" aria-label="查看语言结果">{languages.map((language) => <button type="button" key={language} className={currentLanguage === language ? 'selected' : ''} onClick={() => onLanguageSelect(language)}>{LANGUAGES.find((option) => option.id === language)?.short || language}</button>)}</div>}
      <TranslationView result={result} image={item} />
      {result?.edit_url && <button type="button" className="button button-quiet button-small" onClick={() => onEdit(result)}>局部回贴 / 编辑蒙版</button>}
    </div>}
  </article>;
}

function EmptyWorkspace({ onBrowse }) {
  return <div className="empty-workspace">
    <div className="empty-composition" aria-hidden="true"><div className="sample-image sample-back"><span /><i /><i /></div><div className="sample-image sample-front"><span /><i /><i /><b /></div><div className="sample-translation"><span>Deutsch</span><b>für jeden Tag</b><i>✓</i></div></div>
    <h2>一套商品图，准备好走向更多市场。</h2>
    <p>拖入包含主图、A+ 与品牌故事图片的商品文件夹，<br />工具会按尺寸整理，并准备多语言版本。</p>
    <button type="button" className="button button-primary" onClick={onBrowse}><Icon name="folder" size={17} />选择商品文件夹</button>
    <span className="empty-specs">主图 1:1 <i /> A+ PC 21:9 <i /> A+ 手机 4:3 <i /> 品牌故事 1464×625 / 463×625</span>
  </div>;
}

function SettingsDialog({ open, config, onClose, onSave, saving, message, onTest, testing, testResult }) {
  const [draft, setDraft] = useState(config);
  useEffect(() => { if (open) setDraft(config); }, [open, config]);
  if (!open) return null;
  const update = (section, key, value) => setDraft((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="dialog-head"><div><span className="step-note">浏览器直连远程 API</span><h2 id="settings-title">API 设置</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置"><Icon name="close" /></button></div>
      <p className="dialog-intro">纯静态版：图片会发送给你配置的 API。Key 默认仅保存在当前标签页会话；本网页不能隐藏密钥，请勿使用共享主密钥。API 和成图域名必须允许 CORS。</p>
      {['translation', 'generation'].map((section) => <fieldset className="config-section" key={section}><legend>{section === 'translation' ? '翻译服务' : '图片生成服务'}</legend>
        <label>API 地址<input value={draft?.[section]?.api_url || ''} onChange={(event) => update(section, 'api_url', event.target.value)} placeholder="https://api.example.com/v1" /></label>
        <label>API Key<input type="password" value={draft?.[section]?.api_key || ''} onChange={(event) => update(section, 'api_key', event.target.value)} placeholder={config?.[section]?.api_key_set ? '已保存；留空保持不变' : '粘贴 API Key'} autoComplete="new-password" /></label>
        <label>模型 ID<input value={draft?.[section]?.model || ''} onChange={(event) => update(section, 'model', event.target.value)} placeholder={section === 'translation' ? 'gpt-4o-mini' : 'nano-banana-2'} /></label>
        {section === 'generation' && <label>并发提交数量<input type="number" min="1" max="4" value={draft?.generation?.concurrency ?? 2} onChange={(event) => update('generation', 'concurrency', event.target.value)} placeholder="同时提交的生图任务数，1-4，默认 2" /></label>}
        <label><input type="checkbox" checked={!!draft?.[section]?.clear_key} onChange={event => update(section, 'clear_key', event.target.checked)} />清除此服务已保存的 Key</label>
      </fieldset>)}
      <label><input type="checkbox" checked={!!draft.remember_keys} onChange={e => setDraft(current => ({ ...current, remember_keys: e.target.checked }))} />在此浏览器记住 Key（明文存储，仅限可信个人设备）</label>
      {message && <p className="dialog-message">{message}</p>}
      {testResult && <div className="api-test-results">{Object.entries(testResult.checks || {}).map(([name, result]) => <div className={`api-test-row ${result.reachable ? 'ok' : 'bad'}`} key={name}><span>{name === 'translation' ? '翻译服务' : '生图服务'}</span><strong>{result.reachable ? '● 已连通' : result.ready ? '● 不可达' : '● 未配置'}</strong><small>{result.message}{result.latency_ms ? ` · ${result.latency_ms} ms` : ''}</small></div>)}</div>}
      <div className="dialog-actions"><button type="button" className="button button-quiet" disabled={testing} onClick={() => onTest(draft)}>{testing ? '测试中…' : '测试 API 连通性'}</button><button type="button" className="button button-quiet" onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={saving} onClick={() => onSave(draft)}>{saving ? '保存中…' : '保存设置'}</button></div>
    </section>
  </div>;
}

const STATUS_META = {
  completed: ['已完成', 'ok'],
  review: ['待确认', 'warn'],
  partial: ['部分失败', 'warn'],
  failed: ['失败', 'bad'],
  running: ['处理中', 'run'],
  queued: ['排队中', 'run'],
};

function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function languageShorts(languages) {
  return (languages || []).map((id) => LANGUAGES.find((entry) => entry.id === id)?.short || id);
}

function HistoryStatus({ status }) {
  const [label, tone] = STATUS_META[status] || [status || '未知', 'run'];
  return <span className={`history-status is-${tone}`}>{label}</span>;
}

function HistoryRow({ record, onOpen, onDelete }) {
  const progress = record.progress || {};
  return <article className="history-row">
    <button type="button" className="history-row-main" onClick={onOpen}>
      <div className="history-row-title"><strong title={record.folder || ''}>{record.folder || '商品文件夹'}</strong><HistoryStatus status={record.status} /></div>
      <div className="history-row-meta">
        <span><Icon name="image" size={12} />{record.image_count || 0} 张</span>
        <span><Icon name="language" size={12} />{languageShorts(record.languages).join(' ')}</span>
        <span><Icon name="clock" size={12} />{formatStamp(record.created_at)}</span>
      </div>
      <div className="history-row-progress">{progress.completed || 0}/{progress.total || 0} 完成{progress.failed ? ` · ${progress.failed} 失败` : ''}</div>
    </button>
    <button type="button" className="history-row-delete" onClick={onDelete} aria-label="删除此记录" title="删除此记录"><Icon name="trash" size={14} /></button>
  </article>;
}

function HistoryDetail({ record, onBack, onDelete, onRestore, onEdit }) {
  const progress = record.progress || {};
  const resultsByImage = useMemo(() => {
    const map = new Map();
    (record.results || []).forEach((row) => {
      const list = map.get(row.image_id) || [];
      list.push(row);
      map.set(row.image_id, list);
    });
    return map;
  }, [record]);
  return <div className="history-detail">
    <div className="history-detail-head">
      <button type="button" className="button button-quiet button-small" onClick={onBack}><Icon name="arrow" size={13} />返回列表</button>
      <div className="history-detail-info">
        <strong>{record.folder || '商品文件夹'}</strong>
        <span>{formatStamp(record.created_at)}</span>
        <HistoryStatus status={record.status} />
      </div>
      <div className="history-detail-actions"><button type="button" className="button button-primary button-small" onClick={() => onRestore(record.job_id)}><Icon name="arrow" size={13} />回到工作区</button><button type="button" className="button button-quiet button-small" onClick={onDelete}><Icon name="trash" size={13} />删除记录</button></div>
    </div>
    <div className="history-detail-meta">
      <span><Icon name="image" size={13} />{(record.images || []).length} 张图片</span>
      <span><Icon name="language" size={13} />{languageShorts(record.languages).join(' ')}</span>
      <span><Icon name="stack" size={13} />{progress.completed || 0}/{progress.total || 0} 完成{progress.failed ? ` · ${progress.failed} 失败` : ''}</span>
    </div>
    {record.error && <p className="history-error">{record.error}</p>}
    <div className="history-images">
      {(record.images || []).map((image) => <section className="history-image" key={image.image_id}>
        <header><strong title={image.name}>{image.name}</strong><small>{GROUPS.find((entry) => entry.id === image.category)?.title || image.category}</small><em>{image.width} × {image.height}</em></header>
        {(resultsByImage.get(image.image_id) || []).map((row) => <div className="history-result" key={`${row.image_id}-${row.language}`}>
          <span className="history-result-lang">{LANGUAGES.find((entry) => entry.id === row.language)?.short || row.language}</span>
          <div className="history-result-text">
            <p title={row.translation?.source_text || ''}>{row.translation?.source_text || '未识别到可替换文案'}</p>
            {row.translation?.translated_text && <p className="translated-text" title={row.translation.translated_text}>{row.translation.translated_text}</p>}
            {row.error && <p className="history-result-error">{row.error}</p>}
          </div>
          {row.file_url
            ? <a className="history-result-thumb" href={row.file_url} target="_blank" rel="noreferrer" title="查看成图"><img src={row.file_url} alt={`${row.language} 本地化结果`} loading="lazy" /></a>
            : <span className={`result-state ${row.status === 'failed' ? 'failed' : ''}`}>{row.status === 'failed' ? '失败' : '未生成'}</span>}
          {row.edit_url && <button type="button" className="button button-quiet button-small" onClick={() => onEdit(record.job_id, row.edit_url)}>编辑</button>}
        </div>)}
      </section>)}
    </div>
  </div>;
}

function HistoryDialog({ open, onClose, addLog, onRestore, onEdit }) {
  const backupInput = useRef(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backup = async file => {
    setBackupBusy(true); setError('');
    try {
      if (file) { const result = await importBackup(file); addLog(`导入 ${result.count} 条历史，跳过 ${result.skipped} 条重复记录`); }
      else { const count = await exportBackup(); addLog(`已导出 ${count} 条历史备份（不包含 API Key）`); }
      await loadList();
    } catch (e) { setError(e.message); }
    finally { setBackupBusy(false); }
  };
  const [records, setRecords] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/history');
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '无法读取历史记录');
      setRecords(data.records || []);
      setError('');
    } catch (reason) {
      setError(reason.message || '无法读取历史记录');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setDetail(null);
    void loadList();
    const timer = window.setInterval(() => { void loadList(); }, 6000);
    return () => window.clearInterval(timer);
  }, [open, loadList]);

  const openDetail = async (jobId) => {
    setError('');
    try {
      const response = await fetch(`/api/history/${jobId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '无法读取任务详情');
      setDetail(data);
    } catch (reason) {
      setError(reason.message || '无法读取任务详情');
    }
  };

  const deleteRecord = async (jobId) => {
    if (!window.confirm('确定删除这条历史记录吗？该任务生成的图片也会一并删除。')) return;
    try {
      const response = await fetch(`/api/history/${jobId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '删除失败');
      addLog(`已删除历史记录：${jobId}`);
      if (detail?.job_id === jobId) setDetail(null);
      await loadList();
    } catch (reason) {
      setError(reason.message || '删除失败');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('确定清空全部历史记录吗？所有历史任务生成的图片都会删除。')) return;
    try {
      const response = await fetch('/api/history', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '清空失败');
      addLog(`已清空 ${data.deleted || 0} 条历史记录`);
      setDetail(null);
      await loadList();
    } catch (reason) {
      setError(reason.message || '清空失败');
    }
  };

  if (!open) return null;
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="dialog-head"><div><span className="step-note">仅保留在当前浏览器 / 当前域名，请及时备份</span><h2 id="history-title">历史记录</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭历史记录" title="关闭"><Icon name="close" /></button></div>
      {error && <p className="dialog-message">{error}</p>}
      {detail
        ? <HistoryDetail record={detail} onBack={() => setDetail(null)} onDelete={() => void deleteRecord(detail.job_id)} onRestore={onRestore} onEdit={onEdit} />
        : <>
          <div className="history-toolbar">
            <span className="history-count">{loading ? '读取中…' : records ? `共 ${records.length} 条记录` : ''}</span>
            <div className="history-toolbar-actions">
              <input type="file" ref={backupInput} className="visually-hidden" accept=".zip" onChange={e => { const file = e.target.files?.[0]; if (file) void backup(file); e.target.value = ''; }} />
              <button type="button" className="button button-quiet button-small" disabled={backupBusy} onClick={() => void backup()}>导出备份</button>
              <button type="button" className="button button-quiet button-small" disabled={backupBusy} onClick={() => backupInput.current?.click()}>导入备份</button>
              <button type="button" className="button button-quiet button-small" onClick={() => void loadList()} disabled={loading}><Icon name="refresh" size={14} />刷新</button>
              <button type="button" className="button button-quiet button-small" onClick={() => void clearAll()} disabled={!records?.length}><Icon name="trash" size={14} />清空历史</button>
            </div>
          </div>
          {records?.length
            ? <div className="history-list">{records.map((record) => <HistoryRow key={record.job_id} record={record} onOpen={() => void openDetail(record.job_id)} onDelete={() => void deleteRecord(record.job_id)} />)}</div>
            : <div className="history-empty">{records ? '还没有历史任务记录，完成一次自动本地化后会出现在这里。' : '正在读取历史记录…'}</div>}
        </>}
    </section>
  </div>;
}

function App() {
  const [items, setItems] = useState([]);
  const [folderName, setFolderName] = useState('');
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [selectedLanguages, setSelectedLanguages] = useState(['德语']);
  const [activeLanguage, setActiveLanguage] = useState('德语');
  const [job, setJob] = useState(null);
  const [jobResults, setJobResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [backendOnline, setBackendOnline] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [config, setConfig] = useState({ translation: {}, generation: {} });
  const [savingConfig, setSavingConfig] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [testingConfig, setTestingConfig] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [developerMode, setDeveloperMode] = useState(() => localStorage.getItem('localizer-developer-mode') !== 'false');
  const [logs, setLogs] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [editingPatch, setEditingPatch] = useState(null);
  const fileInputRef = useRef(null);
  const currentItemsRef = useRef(items);
  const workspaceOperation = useRef(false);
  const categoryCounts = useMemo(() => items.reduce((counts, item) => { counts[item.category] += 1; return counts; }, { main: 0, desktop: 0, mobile: 0, brand: 0, review: 0 }), [items]);
  const visibleItems = useMemo(() => items.filter((item) => activeFilter === 'all' || item.category === activeFilter), [items, activeFilter]);
  const addLog = useCallback((message, level = 'info') => setLogs((current) => [...current.slice(-99), { id: crypto.randomUUID(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message, level }]), []);
  const toggleDeveloperMode = () => setDeveloperMode((current) => { const next = !current; localStorage.setItem('localizer-developer-mode', String(next)); return next; });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config').then((response) => { if (!response.ok) throw new Error('浏览器本地存储不可用'); return response.json(); }).then((data) => { if (!cancelled) { setConfig(data); setBackendOnline(true); addLog('静态 Web 就绪：浏览器本地存储可用', 'success'); } }).catch(() => { if (!cancelled) { setBackendOnline(false); addLog('浏览器本地存储不可用', 'error'); } });
    const timer = window.setInterval(() => {
      fetch('/api/health').then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then(() => { if (!cancelled) setBackendOnline(true); }).catch(() => { if (!cancelled) setBackendOnline(false); });
    }, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [addLog]);

  const testApi = async (draft) => {
    setTestingConfig(true); setTestResult(null); setSettingsError('');
    try {
      if (draft) {
        const saved = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        const savedData = await saved.json();
        if (!saved.ok) throw new Error(savedData.detail || '设置保存失败');
        setConfig(savedData);
        addLog('已保存当前表单设置，开始测试 API 连通性');
      } else addLog('开始测试翻译与生图 API 连通性');
      const response = await fetch('/api/config/test', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'API 测试失败');
      setTestResult(data);
      Object.entries(data.checks || {}).forEach(([name, result]) => addLog(`${name === 'translation' ? '翻译' : '生图'}服务：${result.message}`, result.reachable ? 'success' : 'error'));
    } catch (reason) { setSettingsError(reason.message || 'API 测试失败'); addLog(`API 测试失败：${reason.message}`, 'error'); }
    finally { setTestingConfig(false); }
  };

  useEffect(() => { currentItemsRef.current = items; }, [items]);
  useEffect(() => () => currentItemsRef.current.forEach((item) => URL.revokeObjectURL(item.preview)), []);

  const restoreHistory = useCallback(async (jobId, editUrl = '') => {
    if (workspaceOperation.current || busy) return;
    workspaceOperation.current = true;
    setHistoryOpen(false);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/history/${jobId}`);
      const record = await response.json();
      if (!response.ok) throw new Error(record.detail || '无法恢复历史任务');
      const restored = await Promise.all((record.images || []).map(async (image) => {
        const source = await fetch(`/api/history/${jobId}/sources/${encodeURIComponent(image.image_id)}`);
        if (!source.ok) throw new Error(`无法读取历史原图：${image.name || image.image_id}`);
        const blob = await source.blob();
        const fileName = image.name || String(image.relative_path || image.image_id).split('/').pop();
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        return {
          id: image.image_id,
          file,
          relativePath: image.relative_path || fileName,
          name: fileName,
          width: Number(image.width) || 0,
          height: Number(image.height) || 0,
          category: image.category || 'review',
          preview: '',
        };
      }));
      restored.forEach((item) => { item.preview = URL.createObjectURL(item.file); });
      restored.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
      currentItemsRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
      currentItemsRef.current = restored;
      setItems(restored);
      setDirectoryHandle(null);
      setFolderName(record.folder || '商品文件夹');
      setSelectedLanguages(record.languages?.length ? record.languages : ['德语']);
      setActiveLanguage(record.languages?.[0] || '德语');
      setActiveFilter('all');
      setJob(record);
      setJobResults(Object.fromEntries((record.results || []).map((result) => [`${result.image_id}:${result.language}`, result])));
      setHistoryOpen(false);
      if (editUrl) setEditingPatch(editUrl);
      addLog(`已恢复历史任务：${record.folder || jobId}`);
      if (['queued', 'running'].includes(record.status)) await pollJob(jobId);
    } catch (reason) {
      setError(reason.message || '恢复历史任务失败');
      addLog(`恢复历史任务失败：${reason.message || reason}`, 'error');
    } finally {
      workspaceOperation.current = false;
      setBusy(false);
    }
  }, [addLog, busy]);

  const handleEntries = useCallback(async (entries, name) => {
    if (busy || workspaceOperation.current) return;
    setDirectoryHandle(null);
    setError('');
    setJob(null);
    setJobResults({});
    const nextItems = await Promise.all(classifyEntries(entries));
    nextItems.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' }));
    const unreadable = nextItems.filter((item) => !item.width || !item.height);
    const usableItems = nextItems.filter((item) => item.width > 0 && item.height > 0);
    unreadable.forEach((item) => URL.revokeObjectURL(item.preview));
    setItems((previous) => { previous.forEach((item) => URL.revokeObjectURL(item.preview)); return usableItems; });
    setFolderName(name || '商品文件夹');
    addLog(`已读取 ${usableItems.length} 张图片${name ? `（${name}）` : ''}`);
    if (unreadable.length) { setError(`${unreadable.length} 张图片无法读取，已跳过；请检查文件是否损坏。`); addLog(`${unreadable.length} 张图片无法读取，已跳过`, 'error'); }
  }, [addLog, busy]);
  const toggleLanguage = (language) => setSelectedLanguages((current) => current.includes(language) ? current.filter((entry) => entry !== language) : [...current, language]);
  const moveItem = (id, category) => setItems((current) => current.map((item) => item.id === id ? { ...item, category } : item));
  const deleteItem = (item) => {
    if (busy) return;
    if (!window.confirm(`确定要从套图清单删除“${item.name}”吗？`)) return;
    URL.revokeObjectURL(item.preview);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setJobResults((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${item.id}:`))));
    setJob((current) => current ? { ...current, saved_count: 0, skipped_count: 0 } : current);
  };
  const selectAuthorizedDirectory = async (handle) => {
    if (busy) return;
    if (items.length) {
      setDirectoryHandle(handle);
      addLog(`已授权输出文件夹：${handle.name}（保留当前任务）`);
      return;
    }
    setDirectoryHandle(handle);
    setFolderName((current) => current || handle.name);
    try {
      const entries = [];
      const walk = async (directory, prefix = '') => {
        for await (const [name, handleEntry] of directory.entries()) {
          if (handleEntry.kind === 'directory') await walk(handleEntry, `${prefix}${name}/`);
          else if (ACCEPTED.has(name.split('.').pop().toLowerCase())) entries.push({ file: await handleEntry.getFile(), relativePath: `${prefix}${name}` });
        }
      };
      await walk(handle);
      await handleEntries(entries, handle.name);
      setDirectoryHandle(handle);
    } catch (reason) { setError(`读取授权文件夹失败：${reason.message || reason}`); }
  };

  const saveSettings = async (draft) => {
    setSavingConfig(true); setSettingsMessage(''); setSettingsError('');
    try {
      const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '设置保存失败');
      setConfig(data); setSettingsMessage('设置已保存'); setTimeout(() => setSettingsOpen(false), 550);
    } catch (reason) { setSettingsError(reason.message); }
    finally { setSavingConfig(false); }
  };

  const pollJob = useCallback(async (jobId) => {
    let current = null;
    const seen = {};
    while (true) {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error(`读取处理进度失败（${response.status}）`);
      current = await response.json();
      setJob(current);
      setJobResults(Object.fromEntries((current.results || []).map((result) => [`${result.image_id}:${result.language}`, result])));
      (current.results || []).forEach((result) => {
        const key = `${result.image_id}:${result.language}`;
        if (seen[key] === result.status) return;
        seen[key] = result.status;
        if (result.status === 'completed') addLog(`完成：${result.relative_path}（${result.language}）`, 'success');
        else if (result.status === 'failed') addLog(`失败：${result.relative_path}（${result.language}）${result.error ? `：${result.error}` : ''}`, 'error');
      });
      if (['completed', 'failed', 'partial', 'review'].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
    const progress = current.progress || {};
    if (current.status === 'completed') addLog(`任务完成：${progress.completed || 0}/${progress.total || 0} 张图片处理成功`, 'success');
    else if (current.status === 'partial') addLog(`任务部分完成：${progress.completed || 0} 成功、${progress.failed || 0} 失败，可重试`, 'error');
    else if (current.status === 'failed') addLog(`任务失败：${current.error || '未知错误'}`, 'error');
    return current;
  }, [addLog]);

  const startJob = async () => {
    if (busy || !items.length || !selectedLanguages.length) return;
    if (job && !window.confirm('重新生成会调用翻译和生图 API，可能产生费用。现有任务仍保留在历史记录中，是否继续？')) return;
    const configReady = ['translation', 'generation'].every((section) => config?.[section]?.api_url && config?.[section]?.model && config?.[section]?.api_key_set);
    if (!backendOnline || !configReady) { setSettingsOpen(true); setSettingsError(backendOnline ? '请先补全翻译和图片生成 API 设置。' : '请允许浏览器本地存储并配置 API。'); addLog('无法开始：API 配置不完整或浏览器存储不可用', 'error'); return; }
    setBusy(true); setError(''); setJob(null); setJobResults({});
    addLog(`提交本地化任务：${items.length} 张图片 × ${selectedLanguages.length} 种语言（生图并发 ${Math.max(1, Math.min(4, Number(config?.generation?.concurrency) || 2))} 张）`);
    try {
      const form = new FormData();
      form.append('manifest', JSON.stringify({ languages: selectedLanguages, folder: folderName || '', images: items.map(({ id, relativePath, category, width, height, name }) => ({ id, relative_path: relativePath, category, width, height, name })) }));
      for (const item of items) form.append('files', item.file, `file_${item.id}`);
      const response = await fetch('/api/jobs', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '无法开始本地化任务');
      addLog(`任务已创建：${data.job_id}`);
      await pollJob(data.job_id);
    } catch (reason) { setError(reason.message || '本地化任务启动失败'); addLog(`任务启动失败：${reason.message || reason}`, 'error'); }
    finally { setBusy(false); }
  };

  const retryJob = async () => {
    if (busy || !job?.job_id) return;
    setBusy(true); setError('');
    addLog(`重试失败项：${job.job_id}`);
    try {
      for (const row of (job.results || []).filter(r => r.status === 'failed' && r.task?.uncertain && !r.task?.id)) {
        const taskId = window.prompt(`「${row.name} / ${row.language}」上次提交结果不确定。请到 API 供应商后台查询任务 ID 后填入；取消不会重复提交。`);
        if (!taskId) throw Error('已取消接续；请先到供应商后台核对，避免重复付费');
        const resumed = await fetch(`/api/jobs/${job.job_id}/resume`, { method: 'POST', body: JSON.stringify({ image_id: row.image_id, language: row.language, task_id: taskId.trim() }) });
        if (!resumed.ok) throw Error((await resumed.json()).detail);
      }
      const response = await fetch(`/api/jobs/${job.job_id}/retry`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '无法重试失败项');
      await pollJob(job.job_id);
    } catch (reason) { setError(reason.message || '重试失败'); addLog(`重试失败：${reason.message || reason}`, 'error'); }
    finally { setBusy(false); }
  };

  const writeResults = async () => {
    if (!directoryHandle) {
      setBusy(true);
      try { const count = await exportResults(job, new Set(items.map(item => item.id))); addLog(`已下载 ${count} 张已确认成图 ZIP`, 'success'); }
      catch (e) { setError(e.message); }
      finally { setBusy(false); }
      return;
    }
    let handle = directoryHandle;
    if (!directoryHandle) {
      if (!window.showDirectoryPicker) { setError('当前浏览器不支持直接保存文件夹，请使用 Chrome 或 Edge。'); return; }
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); setDirectoryHandle(handle); }
      catch (reason) { if (reason.name !== 'AbortError') setError(`无法授权输出文件夹：${reason.message || reason}`); return; }
    }
    if (!handle) { setError('请重新选择并授权商品文件夹。'); return; }
    if (folderName && handle.name !== folderName) { setError(`请选择「${folderName}」文件夹作为输出位置。`); return; }
    try {
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('未授予文件夹写入权限');
      }
      setBusy(true);
      let savedCount = 0;
      let skippedCount = 0;
      const currentItemIds = new Set(items.map((item) => item.id));
      const successful = (job?.results || []).filter((result) => currentItemIds.has(result.image_id) && result.status === 'completed' && result.file_url);
      const categoryById = new Map(items.map((item) => [item.id, item.category]));
      for (const result of successful) {
        const group = GROUPS.find((entry) => entry.id === (categoryById.get(result.image_id) || result.category));
        const lang = LANGUAGES.find((entry) => entry.id === result.language);
        const fileName = result.output_name
          || (result.output_relative_path || result.relative_path || '').split('/').pop();
        const outputPath = `本地化结果/${lang?.id || result.language}/${group?.folder || '待确认'}/${result.image_id}/${fileName}`;
        const segments = outputPath.split('/').filter(Boolean);
        let directory = handle;
        for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create: true });
        let fileHandle;
        try {
          fileHandle = await directory.getFileHandle(segments.at(-1));
          skippedCount += 1;
          continue;
        } catch (reason) {
          if (reason.name !== 'NotFoundError') throw reason;
        }
        fileHandle = await directory.getFileHandle(segments.at(-1), { create: true });
        const writable = await fileHandle.createWritable();
        const response = await fetch(result.file_url);
        if (!response.ok) throw new Error(`${result.relative_path} 下载结果失败`);
        await writable.write(await response.blob());
        await writable.close();
        savedCount += 1;
      }
      setError('');
      setJob((current) => ({ ...current, saved_count: savedCount, skipped_count: skippedCount }));
      addLog(`已保存 ${savedCount} 张本地化图片到授权文件夹${skippedCount ? `，跳过 ${skippedCount} 张已存在文件` : ''}`, 'success');
    } catch (reason) { setError(`保存结果失败：${reason.message || reason}`); addLog(`保存结果失败：${reason.message || reason}`, 'error'); }
    finally { setBusy(false); }
  };

  const allLanguages = selectedLanguages.map((language) => LANGUAGES.find((entry) => entry.id === language)?.short || language).join('、');
  const chooseFolder = () => fileInputRef.current?.click();

  return <div className="app-shell" id="top">
    <Topbar onSettings={() => { setSettingsError(''); setSettingsMessage(''); setSettingsOpen(true); }} onHistory={() => setHistoryOpen(true)} backendOnline={backendOnline} developerMode={developerMode} onToggleDeveloperMode={toggleDeveloperMode} />
    <input ref={fileInputRef} className="visually-hidden" type="file" webkitdirectory="" directory="" multiple onChange={(event) => { const files = imageEntriesFromPicker(event.target.files || []); void handleEntries(files, files[0]?.relativePath.split('/')[0] || '商品文件夹'); event.target.value = ''; }} aria-label="选择商品图片文件夹" />
    <main className="app-main">
      <div className="page-heading"><div><p className="page-kicker">AMAZON IMAGE LOCALIZATION</p><h1>让每张商品图，<span>说对当地语言。</span></h1><p className="page-subtitle">按图片规格整理套图，翻译文案并生成目标市场版本。</p></div><div className="privacy-tag"><span />本地合成 · API 直连 · 请备份历史</div></div>
      <div className="workspace-layout">
        <Sidebar items={items} reviewCount={categoryCounts.review} folderName={folderName} directoryAuthorized={Boolean(directoryHandle)} selectedLanguages={selectedLanguages} onToggleLanguage={toggleLanguage} busy={busy} job={job} onStart={startJob} onRetry={retryJob} onWrite={writeResults} onEntries={handleEntries} onFolderHandle={selectAuthorizedDirectory} developerMode={developerMode} logs={logs} onClearLogs={() => setLogs([])} />
        <section className="workspace" aria-label="套图工作区">
          {error && <div className="error-banner" role="alert"><Icon name="alert" size={17} /><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><Icon name="close" size={15} /></button></div>}
          {items.length === 0 ? <EmptyWorkspace onBrowse={chooseFolder} /> : <>
            <div className="workspace-head"><div><div className="breadcrumb"><Icon name="folder" size={15} /><span>{folderName || '商品文件夹'}</span><Icon name="chevron" size={13} /></div><h2>套图清单 <span>{items.length}</span></h2></div><div className="workspace-actions"><span className="total-size"><Icon name="stack" size={15} />{formatBytes(items.reduce((total, item) => total + item.file.size, 0))}</span><button type="button" className="button button-quiet button-small" onClick={chooseFolder}><Icon name="folder" size={15} />更换文件夹</button></div></div>
            <div className="category-overview">{GROUPS.slice(0, 4).map((group) => <button className={`overview-cell ${activeFilter === group.id ? 'current' : ''}`} type="button" key={group.id} onClick={() => setActiveFilter(group.id)}><span className={`overview-shape ${group.shape}`} /><span><strong>{categoryCounts[group.id]}</strong><small>{group.title}</small></span><em>{group.ratio}</em></button>)}<div className={`overview-review ${categoryCounts.review ? 'has-review' : ''}`}><Icon name={categoryCounts.review ? 'alert' : 'check'} size={16} /><span>{categoryCounts.review ? `${categoryCounts.review} 张图片需要确认类型` : '所有图片均已归类'}</span></div></div>
            <div className="gallery-toolbar"><CategoryTabs counts={categoryCounts} active={activeFilter} onSelect={setActiveFilter} /><div className="gallery-filter"><button className={activeFilter === 'all' ? 'is-active' : ''} onClick={() => setActiveFilter('all')} type="button">全部 {items.length}</button></div></div>
            {job?.saved_count ? <div className="success-banner"><Icon name="check" size={17} />已写入 {job.saved_count} 张；跳过 {job.skipped_count || 0} 张已有文件，未覆盖它们。</div> : null}
            {visibleItems.length ? <div className="image-grid">{visibleItems.map((item) => <ImageTile key={item.id} item={item} selectedLanguages={selectedLanguages} jobResults={jobResults} activeLanguage={activeLanguage} onLanguageSelect={setActiveLanguage} onMove={moveItem} onDelete={deleteItem} onEdit={(result) => setEditingPatch(result.edit_url)} busy={busy} />)}</div> : <div className="empty-category"><Icon name="image" size={23} /><strong>这个分类还没有图片</strong><span>切换分类查看其他商品图。</span></div>}
            <footer className="workspace-footer"><span>处理语言：{allLanguages || '尚未选择'}</span><span>仅支持 JPG、PNG、WEBP 和 BMP</span></footer>
          </>}
        </section>
      </div>
    </main>
    {editingPatch && <PatchEditor url={editingPatch} onClose={() => setEditingPatch(null)} onUpdated={(data) => { setJob(data.job); setJobResults(Object.fromEntries((data.job.results || []).map((result) => [`${result.image_id}:${result.language}`, result]))); }} />}
    <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} addLog={addLog} onRestore={(jobId) => void restoreHistory(jobId)} onEdit={(jobId, url) => void restoreHistory(jobId, url)} />
    <SettingsDialog open={settingsOpen} config={config} onClose={() => setSettingsOpen(false)} onSave={saveSettings} saving={savingConfig} message={settingsError || settingsMessage} onTest={testApi} testing={testingConfig} testResult={testResult} />
  </div>;
}

export default App;
