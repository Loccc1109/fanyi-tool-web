import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
const memory = () => { const map = new Map(); return { getItem: k=>map.get(k)||null, setItem:(k,v)=>map.set(k,String(v)), removeItem:k=>map.delete(k) }; };
globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
const held=new Set();
Object.defineProperty(navigator,'locks',{value:{request:async (id,options,fn)=>{ if(held.has(id))return fn(null); held.add(id);try{return await fn({name:id})}finally{held.delete(id)}}}});
const {localFetch,settle,publicJob} = await import('../src/local-api.js');
const {putJob,getJob} = await import('../src/storage.js');
const {endpoint,request,generate,saveConfig,publicConfig} = await import('../src/remote.js');

test('static health/config work without any network, and key stays masked',async()=>{
  const real=globalThis.fetch; globalThis.fetch=()=>{throw Error('network forbidden')};
  try {
    assert.equal((await localFetch('/api/health')).status,200);
    saveConfig({translation:{api_url:'https://api.example',api_key:'secret',model:'test'},remember_keys:false});
    const config=await (await localFetch('/api/config')).json();
    assert.equal(config.translation.api_key,undefined); assert.equal(config.translation.api_key_set,true);
    assert.ok(!localStorage.getItem('localizer-web-settings').includes('secret'));
  }finally{globalThis.fetch=real}
});
test('stale jobs restore source blobs, mark interrupted items failed, and delete fully',async()=>{
  const blob=new Blob(['original'],{type:'image/png'}),job={job_id:'history-test',status:'running',created_at:new Date().toISOString(),images:[{image_id:'image',name:'x.png'}],languages:['德语'],sources:{image:blob},results:[{image_id:'image',language:'德语',status:'running',task:{id:'remote-existing'}}]};
  await putJob(job);
  const publicRecord=await (await localFetch('/api/history/history-test')).json();
  assert.equal(publicRecord.status,'failed');assert.equal(publicRecord.results[0].task.id,'remote-existing');assert.equal(publicRecord.sources,undefined);
  assert.equal(await (await localFetch('/api/history/history-test/sources/image')).text(),'original');
  assert.equal((await localFetch('/api/history/history-test',{method:'DELETE'})).status,200);
  assert.equal((await localFetch('/api/history/history-test')).status,404);
});
test('missing sources and routes return bounded errors',async()=>{
  assert.equal((await localFetch('/api/not-found')).status,404);
  assert.equal((await localFetch('/api/jobs',{method:'POST',body:new FormData()})).status,400);
});
test('task URLs normalized and insecure arbitrary hosts rejected',()=>{
  assert.equal(endpoint('https://host/v1','generation'),'https://host/v1/tasks');
  assert.equal(endpoint('https://host/v1/chat/completions','translation'),'https://host/v1/chat/completions');
  assert.throws(()=>endpoint('http://host','generation'));
  assert.throws(()=>endpoint('https://host?key=secret','generation'));
});
test('existing paid task resumes without a POST and download never receives Authorization',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init});
    return String(url).includes('/tasks/existing')?new Response(JSON.stringify({data:{status:'success',result_urls:['https://images.example/result.png']}})):new Response(new Blob(['pixels']));
  };
  try{
    const row={task:{id:'existing',endpoint:'https://api.example/v1/tasks'}};
    const blob=await generate(row,{},null,{api_url:'https://api.example',api_key:'secret',timeout_seconds:30},async()=>{});
    assert.equal(await blob.text(),'pixels');assert.equal(calls.length,2);
    assert.ok(calls.every(c=>c.init.method==='GET'));
    assert.equal(calls[1].init.headers.Authorization,undefined);
  }finally{globalThis.fetch=original}
});
test('uncertain paid submission cannot silently create another task',async()=>{
  await assert.rejects(()=>generate({task:{uncertain:true,endpoint:'https://api.example/v1/tasks'}},{},null,{api_url:'https://api.example'},async()=>{}),/不确定/);
});
test('status settlement treats reviewed results separately from exportable completion',()=>{
  const job={images:[],results:[{status:'review'},{status:'completed'}]};settle(job);
  assert.equal(job.status,'review');assert.equal(job.progress.review,1);assert.equal(job.progress.completed,2);
});
