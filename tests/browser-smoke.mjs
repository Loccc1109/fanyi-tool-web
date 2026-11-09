// Uses an installed browser; all remote API traffic is mocked. No paid calls.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encodePNG } from '../src/png.js';
const root = path.resolve('dist');
const server = createServer(async(req,res)=>{
  const name = path.join(root,decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!name.startsWith(root+path.sep)) {res.writeHead(403);res.end();return}
  try { const data=await readFile(name);res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');
    const headers=await readFile(path.join(root,'_headers'),'utf8');for(const line of headers.split('\n').slice(1)) {const match=line.match(/^  ([^:]+): (.+)$/);if(match)res.setHeader(match[1],match[2]);}
    res.end(data);
  }catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
let browser;
try {
  const executable = process.env.BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
  const context=await browser.newContext({acceptDownloads:true});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const w=64,h=48,original=new Uint8ClampedArray(w*h*4), ai=new Uint8ClampedArray(original.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=(x*17+y*31+(x*y)%251)%256;original[i]=v;original[i+1]=(v+67)%256;original[i+2]=(v+139)%256;original[i+3]=255;}
  ai.set(original);for(let y=12;y<20;y++)for(let x=12;x<25;x++){const i=(y*w+x)*4;ai[i]=255-ai[i];ai[i+1]=255-ai[i+1];}
  const source=Buffer.from(await encodePNG(original,w,h).arrayBuffer()),raw=Buffer.from(await encodePNG(ai,w,h).arrayBuffer());
  let submissions=0;
  await context.route('https://mock.example/**',async route=>{
    const req=route.request(),url=req.url();const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    if(req.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(url.endsWith('/chat/completions')){
      const payload=req.postDataJSON(),text=payload.messages[0].content.find(p=>p.type==='text'&&p.text.startsWith('IMAGE_ID:')).text;
      return route.fulfill({json:{choices:[{message:{content:JSON.stringify({translation_results:[{image_id:text.slice(10),replacements:[{source_text:'Hello',translated_text:'Hallo',source_box:[.18,.24,.4,.43],target_box:[.18,.24,.4,.43]}]}]})}}]},headers});
    }
    if(url.endsWith('/tasks')) {submissions++;return route.fulfill({json:{data:{id:'existing-test-task'}},headers})}
    if(url.endsWith('/tasks/existing-test-task'))return route.fulfill({json:{data:{status:'succeeded',result_urls:['https://mock.example/result.png']}},headers});
    if(url.endsWith('/result.png'))return route.fulfill({body:raw,contentType:'image/png',headers});
    throw Error('unexpected network: '+url);
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByText('静态 Web 已就绪').waitFor();
  await page.getByRole('button',{name:'API 设置',exact:true}).click();
  const fields=page.locator('.config-section');
  for(let i=0;i<2;i++){
    await fields.nth(i).getByLabel('API 地址').fill('https://mock.example/v1');
    await fields.nth(i).getByLabel('API Key',{exact:true}).fill('mock-secret-not-real');
    await fields.nth(i).getByLabel('模型 ID').fill(i?'image-test':'translation-test');
  }
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.locator('.settings-dialog').waitFor({state:'hidden'});
  // Set input files with webkitdirectory using a real temporary folder.
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
  const folder=await mkdtemp(path.join(tmpdir(),'localizer-web-smoke-'));await writeFile(path.join(folder,'A1.png'),source);
  try{
    await page.locator('input[aria-label="选择商品图片文件夹"]').setInputFiles(folder);
    await page.locator('.image-tile').waitFor();
    await page.getByRole('button',{name:'开始自动本地化'}).click();
    await page.locator('.image-tile').getByRole('button',{name:/编辑/}).waitFor({timeout:60000});
    await page.locator('.image-tile').getByRole('button',{name:/编辑/}).click();
    await page.locator('.patch-dialog').waitFor();
    await page.getByRole('button',{name:'确认此结果',exact:true}).waitFor();
    // Draw a real soft brush stroke on the mask, then save the worker's final preview.
    await page.getByLabel('边缘',{exact:false}).selectOption('soft');
    const canvas=page.locator('.patch-canvas-wrap canvas'),box=await canvas.boundingBox();
    await page.mouse.move(box.x+box.width*.3,box.y+box.height*.35);await page.mouse.down();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.35,{steps:4});await page.mouse.up();
    await page.getByRole('button',{name:'确认此结果',exact:true}).click({timeout:60000});
    await page.getByText('已确认并保存 PNG。').waitFor();
    await page.locator('.patch-dialog header').getByRole('button',{name:'关闭',exact:true}).click();
    // ZIP results are actual browser downloads, not server writes.
    const resultDownload=page.waitForEvent('download');await page.getByRole('button',{name:'保存结果 / 下载 ZIP'}).click();
    const resultZip=await resultDownload;assert.match(resultZip.suggestedFilename(),/成图\.zip$/);
    await page.reload();await page.getByText('静态 Web 已就绪').waitFor();
    await page.getByRole('button',{name:'历史记录',exact:true}).click();await page.locator('.history-row-main').first().click();
    await page.getByRole('button',{name:'回到工作区'}).click();await page.locator('.image-tile').waitFor();
    await page.locator('.image-tile').getByRole('button',{name:/编辑/}).click();await page.locator('.patch-dialog').waitFor();
    await page.getByRole('button',{name:'保存待确认草稿'}).click({timeout:60000});await page.getByText('草稿已保存，仍待确认。').waitFor();
    await page.locator('.patch-dialog header').getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'历史记录',exact:true}).click();
    const backupDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出备份',exact:true}).click();const backup=await backupDownload;
    const backupPath=path.join(folder,'backup.zip');await backup.saveAs(backupPath);
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'清空历史',exact:true}).click();
    await page.getByText('还没有历史任务记录，完成一次自动本地化后会出现在这里。').waitFor();
    await page.locator('.history-toolbar-actions input[type=file]').setInputFiles(backupPath);
    await page.locator('.history-row-main').first().waitFor({timeout:60000});
    await page.locator('.history-row-main').first().click();await page.getByRole('button',{name:'回到工作区'}).click();await page.locator('.image-tile').waitFor();
    assert.equal(submissions,1,'history/edits/import must not submit a second paid task');
    assert.deepEqual(errors,[]);
    console.log('PASS: static browser generation, soft mask/save, ZIP export, reload/history edit, backup clear/import; paid submissions mocked=1');
  }finally{await rm(folder,{recursive:true,force:true})}
  await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
