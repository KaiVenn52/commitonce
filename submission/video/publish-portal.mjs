import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateCapture,validatePortalDuration,validateTerminalLines} from './validation.mjs';
const base=new URL('./',import.meta.url);
const data=JSON.parse(await readFile(new URL('public/data.json',base),'utf8'));
const session=JSON.parse(await readFile(new URL('public/session.json',base),'utf8'));
const log=validateCapture(session);
for(const id of ['PortalPitch','PortalDemo'])validatePortalDuration(id,data.videos[id].duration);
validateTerminalLines(log,data.videos.PortalDemo.scenes);
await writeFile(new URL('out/portal-video-data.json',base),JSON.stringify({recordedAt:session.date,disclosure:data.disclosure,videos:{PortalPitch:data.videos.PortalPitch,PortalDemo:data.videos.PortalDemo}},null,2));
const files=['portalpitch.mp4','portaldemo.mp4','portalpitch.srt','portaldemo.srt','portal-video-data.json'];
const manifest={preparedAt:'2026-10-11',recordedAt:session.date,limits:{pitchSeconds:120,demoSeconds:180},disclosure:'Synthetic English narration; edited replay of genuine devnet terminal output, not current live feed.',files:[]};
for(const name of files){const bytes=await readFile(new URL('out/'+name,base));manifest.files.push({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(new URL('out/portal-manifest.json',base),JSON.stringify(manifest,null,2));
console.log('Portal asset manifest generated; historical release assets unchanged.');
