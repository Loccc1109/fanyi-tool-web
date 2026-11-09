import test from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { allowedMask, warp, differenceMask, featherMask, mergePixels, estimateTranslation, validateParams } from '../src/pixels.js';
import { encodePNG } from '../src/png.js';

test('PNG stores exact RGBA, including semi-transparent and transparent channels', async () => {
  const input = Uint8ClampedArray.from([3,7,19,0, 180,29,72,83, 241,222,14,255, 1,2,3,128]);
  const bytes = new Uint8Array(await encodePNG(input, 2, 2).arrayBuffer());
  assert.deepEqual([...bytes.slice(0,8)], [137,80,78,71,13,10,26,10]);
  const view = new DataView(bytes.buffer); let scan;
  for (let offset = 8; offset < bytes.length;) {
    const size = view.getUint32(offset), name = new TextDecoder().decode(bytes.slice(offset+4,offset+8));
    if (name === 'IDAT') scan = unzlibSync(bytes.slice(offset+8,offset+8+size));
    offset += size + 12;
  }
  assert.equal(scan[0],0); assert.equal(scan[9],0);
  assert.deepEqual([...scan.slice(1,9), ...scan.slice(10,18)], [...input]);
});
test('grayscale alpha and feather preserve exact pixels outside effective mask', () => {
  const w = 15, h = 15, source = new Uint8ClampedArray(w*h*4), ai = new Uint8ClampedArray(source.length);
  for (let i=0;i<source.length;i++) { source[i]=(i*13)%256; ai[i]=255-source[i]; }
  const mask = new Uint8ClampedArray(w*h); mask[7*w+7]=128;
  for (const radius of [0,1]) {
    const effective = featherMask(mask,w,h,radius), result=mergePixels(source,ai,effective);
    let zeros=0;
    for(let i=0;i<effective.length;i++) if (!effective[i]) { zeros++; assert.deepEqual(result.slice(i*4,i*4+4), source.slice(i*4,i*4+4)); }
    assert.ok(zeros>0);
  }
  const result=mergePixels(source,ai,mask), k=(7*w+7)*4;
  assert.equal(result[k],Math.round((ai[k]*128+source[k]*127)/255));
});
test('allowed masks accept normalized boxes only and differences never escape them', () => {
  const w=32,h=32, source=new Uint8ClampedArray(w*h*4), ai=new Uint8ClampedArray(source.length).fill(255);
  assert.equal(allowedMask(w,h,[{source_box:[0,0,100,100]}]).some(Boolean),false);
  const allowed=allowedMask(w,h,[{source_box:[.3,.3,.5,.5]}]), mask=differenceMask(source,ai,allowed,w,h);
  assert.ok(mask.some(Boolean));
  for(let i=0;i<mask.length;i++) if(!allowed[i]) assert.equal(mask[i],0);
});
test('warping only AI preserves original base and rejects unsafe transforms', () => {
  const source=new Uint8ClampedArray(4*4*4).fill(50), raw=new Uint8ClampedArray(source.length).fill(180), before=source.slice();
  const result=warp(source,raw,4,4,{dx:.3,dy:0,sx:1,sy:1},new Uint8Array(16));
  assert.deepEqual(source,before); assert.equal(result[0],180);
  assert.throws(()=>validateParams({sx:2},4,4));
  assert.throws(()=>featherMask(new Uint8Array(16),4,4,21));
});
test('alignment accepts same textured image but refuses flat low-information images', () => {
  const w=48,h=48,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<data.length;i+=4) { const value=(i*17+(i%29)*31)%255; data[i]=data[i+1]=data[i+2]=value; data[i+3]=255; }
  assert.equal(estimateTranslation(data,data,new Uint8Array(w*h),w,h).ok,true);
  assert.equal(estimateTranslation(new Uint8Array(data.length),new Uint8Array(data.length),new Uint8Array(w*h),w,h).ok,false);
});
