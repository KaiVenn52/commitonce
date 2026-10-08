import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateCapture} from './validation.mjs';
const data=JSON.parse(await readFile(new URL('./public/data.json',import.meta.url)));
const session=JSON.parse(await readFile(new URL('./public/session.json',import.meta.url)));
const text=validateCapture(session);
assert.throws(()=>validateCapture({...session,exitCode:1}));
assert.throws(()=>validateCapture({...session,chunks:[{text:text.replaceAll('counter onchain 2','counter onchain 1')}]}));
assert.throws(()=>validateCapture({...session,chunks:[{text:text.replaceAll('FAILED — AlreadyCommitted','FAILED — unrelated error')}]}));
console.log('Capture validation: real run accepted; failed exit, wrong A result, unrelated rejection all rejected.');
for(const id of ['Pitch','Demo']){
 const path=new URL(`./out/${id.toLowerCase()}.mp4`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');
 const media=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',decodeURIComponent(path)],{encoding:'utf8'}));
 const duration=Number(media.format.duration);assert.ok(duration<180);if(id==='Pitch')assert.ok(duration>=120);
 assert.ok(media.streams.some(s=>s.codec_type==='audio'));const v=media.streams.find(s=>s.codec_type==='video');assert.equal(v.width,1920);assert.equal(v.height,1080);
 assert.ok(Math.abs(duration-data.videos[id].duration)<0.15);
 console.log(`${id}: ${duration}s · 1920x1080 · audio present · PASS`);
}
