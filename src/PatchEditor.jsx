import { useEffect, useRef, useState } from 'react';
import { localFetch as fetch } from './local-api.js';

const asset = (url, name) => `${url}/assets/${name}`;
async function loadImage(src) {
  let objectURL;
  if (src.startsWith('/api/')) {
    const response = await fetch(src);
    if (!response.ok) throw Error((await response.json()).detail || '无法读取图片');
    objectURL = URL.createObjectURL(await response.blob());
  }
  try { return await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('无法解码编辑素材')); img.src = objectURL || src; }); }
  finally { if (objectURL) URL.revokeObjectURL(objectURL); }
}

export default function PatchEditor({ url, onClose, onUpdated }) {
  const [info, setInfo] = useState(null);
  const [original, setOriginal] = useState(null);
  const [aligned, setAligned] = useState(null);
  const [mask, setMask] = useState(0);
  const [rendered, setRendered] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [params, setParams] = useState({ dx: 0, dy: 0, sx: 1, sy: 1, color: false });
  const [tool, setTool] = useState('brush');
  const [brush, setBrush] = useState(24);
  const [hardness, setHardness] = useState('hard');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [feather, setFeather] = useState(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const canvasRef = useRef(null), wrapRef = useRef(null), maskRef = useRef(null), drawing = useRef(null), undo = useRef([]), redo = useRef([]);
  const base = url;
  const previewKey = JSON.stringify([params, mask, feather]);
  const previewReady = rendered?.key === previewKey;

  useEffect(() => {
    if (!info || !maskRef.current) return;
    const controller = new AbortController();
    let live = true;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${url}/preview`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params, feather, mask: maskRef.current.toDataURL('image/png') }) });
        const data = await response.json();
        if (!response.ok) throw Error(data.detail || '合成预览失败');
        const result = await loadImage(data.result);
        if (live) setRendered({ key: previewKey, image: result });
      } catch (error) { if (live && error.name !== 'AbortError') setMessage(error.message); }
      finally { if (live) setPreviewing(false); }
    }, 250);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [url, info, previewKey]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(url); const data = await r.json(); if (!r.ok) throw Error(data.detail || '无法载入编辑素材');
        const [o, a, m] = await Promise.all(['original.png', 'aligned.png', 'mask.png'].map(async n => loadImage(asset(base, n))));
        if (!live) return;
        setInfo(data); setOriginal(o); setAligned(a); setParams(data.settings.params || params); setFeather(data.settings.feather || 0);
        const c = document.createElement('canvas'); c.width = data.width; c.height = data.height; c.getContext('2d').drawImage(m, 0, 0); maskRef.current = c;
        setBusy(false);
      } catch (e) { setMessage(e.message); setBusy(false); }
    })(); return () => { live = false; };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !original || !aligned || !maskRef.current) return;
    canvas.width = original.naturalWidth; canvas.height = original.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(original, 0, 0);
    if (compareOriginal) return;
    if (rendered?.key === previewKey) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(rendered.image, 0, 0);
    } else {
      const patch = document.createElement('canvas'); patch.width = canvas.width; patch.height = canvas.height;
      patch.getContext('2d').drawImage(aligned, 0, 0);
      const pc = patch.getContext('2d'), src = pc.getImageData(0, 0, patch.width, patch.height), m = maskRef.current.getContext('2d').getImageData(0,0,patch.width,patch.height);
      const basePixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i=0;i<m.data.length;i+=4) {
        const alpha = m.data[i];
        for (let channel=0;channel<4;channel+=1) basePixels.data[i+channel] = Math.round((src.data[i+channel]*alpha + basePixels.data[i+channel]*(255-alpha))/255);
      }
      ctx.putImageData(basePixels,0,0);
    }
    if (showMask) {
      // Display-only overlay: never write blue pixels into the saved grayscale mask.
      const overlay = document.createElement('canvas'); overlay.width = canvas.width; overlay.height = canvas.height;
      const oc = overlay.getContext('2d');
      const pixels = maskRef.current.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const strength = pixels.data[i];
        pixels.data[i] = 40; pixels.data[i + 1] = 130; pixels.data[i + 2] = 255;
        pixels.data[i + 3] = Math.round(strength * .45);
      }
      oc.putImageData(pixels, 0, 0);
      ctx.drawImage(overlay, 0, 0);
    }
  }, [original, aligned, mask, info, compareOriginal, showMask, rendered, previewKey]);

  const point = e => { const r=canvasRef.current.getBoundingClientRect(); return {x:(e.clientX-r.left)*canvasRef.current.width/r.width,y:(e.clientY-r.top)*canvasRef.current.height/r.height}; };
  const showCursor = e => {
    if (!wrapRef.current || !canvasRef.current || (tool !== 'brush' && tool !== 'erase')) { setCursor(null); return; }
    const wrap = wrapRef.current.getBoundingClientRect();
    const canvas = canvasRef.current.getBoundingClientRect();
    const scaleX = canvas.width / canvasRef.current.width;
    const scaleY = canvas.height / canvasRef.current.height;
    setCursor({ left: canvas.left - wrap.left + (e.clientX - canvas.left), top: canvas.top - wrap.top + (e.clientY - canvas.top), width: brush * scaleX, height: brush * scaleY, soft: hardness === 'soft' });
  };
  const snapshot = () => { undo.current.push(maskRef.current.getContext('2d').getImageData(0,0,maskRef.current.width,maskRef.current.height)); const limit = Math.max(1, Math.min(20, Math.floor(64 * 1024 * 1024 / (maskRef.current.width * maskRef.current.height * 4)))); while(undo.current.length > limit) undo.current.shift(); redo.current=[]; };
  const start = e => { if(busy || compareOriginal || !maskRef.current || e.button !== 0)return; e.preventDefault(); canvasRef.current.setPointerCapture(e.pointerId); snapshot(); const p=point(e); drawing.current={...p, last:p}; if(tool==='rect')return; paint(p); };
  const softStamp = (c, x, y) => {
    const radius = brush / 2;
    const left = Math.max(0, Math.floor(x - radius)), top = Math.max(0, Math.floor(y - radius));
    const right = Math.min(c.canvas.width, Math.ceil(x + radius)), bottom = Math.min(c.canvas.height, Math.ceil(y + radius));
    if (right <= left || bottom <= top) return;
    const image = c.getImageData(left, top, right - left, bottom - top);
    for (let yy = 0; yy < image.height; yy += 1) for (let xx = 0; xx < image.width; xx += 1) {
      const distance = Math.hypot(left + xx - x, top + yy - y) / radius;
      if (distance >= 1) continue;
      const strength = 1 - distance;
      const index = (yy * image.width + xx) * 4;
      const oldValue = image.data[index];
      const value = tool === 'erase'
        ? Math.round(oldValue * (1 - strength))
        : Math.max(oldValue, Math.round(255 * strength));
      image.data[index] = value; image.data[index + 1] = value; image.data[index + 2] = value; image.data[index + 3] = 255;
    }
    c.putImageData(image, left, top);
  };
  const paint = p => {
    const c = maskRef.current.getContext('2d');
    const from = drawing.current.last;
    const distance = Math.hypot(p.x - from.x, p.y - from.y);
    if (hardness === 'soft') {
      const radius = brush / 2;
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * .28)));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        softStamp(c, from.x + (p.x - from.x) * t, from.y + (p.y - from.y) * t);
      }
    } else {
      c.beginPath(); c.lineCap='round'; c.lineJoin='round'; c.lineWidth=brush; c.strokeStyle=tool==='erase'?'black':'white';
      if (distance === 0) { c.fillStyle=c.strokeStyle; c.arc(p.x,p.y,brush/2,0,Math.PI*2); c.fill(); }
      else { c.moveTo(from.x, from.y); c.lineTo(p.x, p.y); c.stroke(); }
    }
    drawing.current.last=p; setMask(v=>v+1);
  };
  const move = e => {
    showCursor(e);
    if(!drawing.current)return;
    const p=point(e); if(tool==='rect'){setMask(v=>v+1);return;} paint(p);
  };
  const end = e => {if(!drawing.current)return; const d=drawing.current; if(tool==='rect'){const p=point(e);const c=maskRef.current.getContext('2d'); c.fillStyle='white'; c.fillRect(Math.min(d.x,p.x),Math.min(d.y,p.y),Math.abs(p.x-d.x),Math.abs(p.y-d.y));setMask(v=>v+1);} drawing.current=null;};
  const history = direction => {const from=direction==='undo'?undo.current:redo.current, to=direction==='undo'?redo.current:undo.current;if(!from.length)return;to.push(maskRef.current.getContext('2d').getImageData(0,0,maskRef.current.width,maskRef.current.height));maskRef.current.getContext('2d').putImageData(from.pop(),0,0);setMask(v=>v+1);};
  const autoMask = async () => { setBusy(true); try {const r=await fetch(`${url}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({params,auto_mask:true})}); const d=await r.json();if(!r.ok)throw Error(d.detail); const [a,m]=await Promise.all([loadImage(d.aligned),loadImage(d.mask)]);setAligned(a);const c=maskRef.current;c.getContext('2d').clearRect(0,0,c.width,c.height);c.getContext('2d').drawImage(m,0,0);setMask(v=>v+1);undo.current=[];redo.current=[];setMessage('差异蒙版已更新，请逐项检查边缘。');}catch(e){setMessage(e.message)}finally{setBusy(false)} };
  const previewAlign = async () => {setBusy(true);try{const r=await fetch(`${url}/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({params})});const d=await r.json();if(!r.ok)throw Error(d.detail);setAligned(await loadImage(d.aligned));setMessage('对齐预览已更新。');}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  const save = async confirm => {setBusy(true);try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({params,mask:maskRef.current.toDataURL('image/png'),feather:Number(feather),revision:info.row.revision||0,confirm})});const d=await r.json();if(!r.ok)throw Error(d.detail);setInfo({...info,row:d.row});onUpdated(d);setMessage(confirm?'已确认并保存 PNG。':'草稿已保存，仍待确认。');}catch(e){setMessage(e.message)}finally{setBusy(false)}};
  return <div className="patch-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="patch-dialog" role="dialog" aria-modal="true"><header><div><b>局部回贴 · {info?.row?.language||''}</b><p>{showMask ? '蓝色显示绘制的蒙版范围（不写入成图）；关闭后查看纯合成效果。' : '当前显示原图与蒙版合成结果；蒙版外像素保留原图。'}按住对比时仅显示原图。</p></div><button onClick={onClose}>关闭</button></header>
    {info?.row?.review_reason&&<p className="patch-warning">待审核：{info.row.review_reason}</p>}
    <fieldset disabled={busy || !info} className="patch-controls"><label>工具 <select value={tool} onChange={e=>{setTool(e.target.value);setCursor(null)}}><option value="brush">画笔</option><option value="erase">擦除</option><option value="rect">矩形框选</option></select></label><label>笔刷 <input type="range" min="2" max="160" value={brush} onChange={e=>setBrush(+e.target.value)}/>{brush}px</label><label>边缘 <select value={hardness} onChange={e=>setHardness(e.target.value)}><option value="hard">实心</option><option value="soft">柔边</option></select></label><button onClick={()=>history('undo')} disabled={!undo.current.length}>撤销</button><button onClick={()=>history('redo')} disabled={!redo.current.length}>重做</button><button onClick={autoMask}>重新生成差异蒙版</button><button aria-pressed={showMask} title="仅切换蓝色蒙版辅助显示，不改变蒙版或保存结果" onClick={()=>setShowMask(value=>!value)}>{showMask ? '隐藏修改范围' : '显示修改范围'}</button><button className="patch-compare" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setCompareOriginal(true)}} onPointerUp={()=>setCompareOriginal(false)} onPointerCancel={()=>setCompareOriginal(false)} onLostPointerCapture={()=>setCompareOriginal(false)} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();setCompareOriginal(true)}}} onKeyUp={()=>setCompareOriginal(false)} onBlur={()=>setCompareOriginal(false)}>按住对比原图</button></fieldset>
    <fieldset disabled={busy || !info} className="patch-controls"><label>水平位移 <input type="number" value={params.dx} onChange={e=>setParams({...params,dx:+e.target.value})}/></label><label>垂直位移 <input type="number" value={params.dy} onChange={e=>setParams({...params,dy:+e.target.value})}/></label><label>X 缩放 <input type="number" step="0.001" value={params.sx} onChange={e=>setParams({...params,sx:+e.target.value})}/></label><label>Y 缩放 <input type="number" step="0.001" value={params.sy} onChange={e=>setParams({...params,sy:+e.target.value})}/></label><button onClick={previewAlign}>预览对齐</button><label><input type="checkbox" checked={!!params.color} onChange={e=>setParams({...params,color:e.target.checked})}/> AI 颜色微调（谨慎）</label><label>蒙版羽化 <input type="number" min="0" max="20" value={feather} onChange={e=>setFeather(+e.target.value)}/>px</label></fieldset>
    <div className="patch-canvas-wrap" ref={wrapRef}>{busy&&!original?<p>正在加载…</p>:<><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerLeave={()=>{if(!drawing.current)setCursor(null)}} onPointerUp={end} onPointerCancel={end} />{cursor&&!compareOriginal&&<span className={`patch-brush-cursor${cursor.soft?' is-soft':''}`} style={{left:cursor.left,top:cursor.top,width:cursor.width,height:cursor.height}} />}</>}</div>
    {previewing && <p className="patch-message">正在更新最终合成预览（含柔边与羽化）…</p>}{message&&<p className="patch-message">{message}</p>}<footer><span>完成并确认后才会进入批量保存；PNG 无损编码，非原始文件字节或元数据复刻。</span><button disabled={busy || previewing || !previewReady} onClick={()=>save(false)}>保存待确认草稿</button><button className="patch-confirm" disabled={busy || previewing || !previewReady} onClick={()=>save(true)}>确认此结果</button></footer>
  </section></div>;
}
