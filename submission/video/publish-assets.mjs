import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateCapture} from './validation.mjs';
const here=fileURLToPath(new URL('./',import.meta.url));
await mkdir(here+'out',{recursive:true});
const session=JSON.parse(await readFile(here+'public/session.json','utf8'));
validateCapture(session);
// Redact only the personal local key-file path. Transaction data, order and timestamps stay intact.
for(const chunk of session.chunks)chunk.text=chunk.text.replace(/(payer source\s+\$PAYER_KEYPAIR) \([^\r\n]+\)/g,'$1 (local path redacted)');
session.redaction='Only the local payer-file path was redacted; no key material was captured.';
await writeFile(here+'out/session.json',JSON.stringify(session,null,2));
await writeFile(here+'out/session.log',session.chunks.map(c=>c.text).join(''));
await copyFile(here+'public/data.json',here+'out/video-data.json');
const files=['pitch.mp4','demo.mp4','pitch.srt','demo.srt','session.json','session.log','video-data.json','transaction-links.txt'];
const manifest={recordedAt:session.date,disclosure:'Synthetic narration; edited terminal replay, not unedited screen footage.',files:[]};
for(const name of files){const bytes=await readFile(here+'out/'+name);manifest.files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(here+'out/manifest.json',JSON.stringify(manifest,null,2));
console.log('Publication assets complete; local payer path redacted.');
