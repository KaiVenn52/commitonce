import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(await readFile(new URL('./out/manifest.json',import.meta.url)));
const base='https://github.com/KaiVenn52/commitonce/releases/download/submission-2026-10-08/';
for(const name of ['pitch.mp4','demo.mp4','session.json','session.log']){
 const expected=manifest.files.find(f=>f.name===name);
 const response=await fetch(base+name);
 assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.equal(bytes.length,expected.bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256);
 console.log(`${name}: anonymous HTTP 200, exact published SHA-256 PASS`);
}
for(const url of ['https://kaivenn52.github.io/commitonce/','https://kaivenn52.github.io/commitonce/apps/web/videos.html']){
 const response=await fetch(url);assert.equal(response.status,200);console.log(`${url}: anonymous HTTP 200 PASS`);
}
