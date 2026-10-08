// The composition is editorial: change visuals at caption boundaries rather than rendering
// thousands of identical holds. Remotion remains the source of every displayed frame.
import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderStill} from '@remotion/renderer';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('./',import.meta.url));
const data=JSON.parse(await readFile(here+'public/data.json'));
await mkdir(here+'out/frames',{recursive:true});
const url=await bundle({entryPoint:here+'index.tsx',publicDir:here+'public'});
const browser=await openBrowser('chrome');
try{
 for(const id of ['Pitch','Demo']){
  const composition=await selectComposition({serveUrl:url,id,puppeteerInstance:browser});
  let concat='',n=0;
  for(const scene of data.videos[id].scenes){
   const spans=[...scene.captions.map(c=>({start:c.start,end:c.end,at:(c.start+c.end)/2})),{start:scene.audioSeconds,end:scene.duration,at:scene.duration-0.05}];
   for(const span of spans){
    const name=`${id}-${n++}.png`,file=here+'out/frames/'+name;
    await renderStill({serveUrl:url,composition,puppeteerInstance:browser,output:file,frame:Math.min(composition.durationInFrames-1,Math.round((scene.start+span.at)*30))});
    concat+=`file 'frames/${name}'\nduration ${span.end-span.start}\n`;
   }
   console.log(`${id}: scene ${data.videos[id].scenes.indexOf(scene)+1} frames captured`);
  }
  concat+=`file 'frames/${id}-${n-1}.png'\n`;
  await writeFile(here+`out/${id}-frames.txt`,concat);
  const inputs=data.videos[id].scenes.flatMap(s=>['-i',here+'public/'+s.asset]);
  const filters=data.videos[id].scenes.map((s,i)=>`[${i}:a]apad=whole_dur=${s.duration},atrim=duration=${s.duration},asetpts=PTS-STARTPTS[a${i}]`).join(';')+';'+data.videos[id].scenes.map((_,i)=>`[a${i}]`).join('')+`concat=n=${data.videos[id].scenes.length}:v=0:a=1[a]`;
  execFileSync('ffmpeg',['-y','-loglevel','error',...inputs,'-filter_complex',filters,'-map','[a]','-c:a','aac','-b:a','160k',here+`out/${id}-audio.m4a`],{stdio:'inherit'});
  execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',here+`out/${id}-frames.txt`,'-i',here+`out/${id}-audio.m4a`,'-t',String(data.videos[id].duration),'-r','30','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','copy','-movflags','+faststart',here+`out/${id.toLowerCase()}.mp4`],{stdio:'inherit'});
  for(const [label,seconds] of [['opening',3],['proof',id==='Pitch'?100:65],['closing',data.videos[id].duration-4]])await renderStill({serveUrl:url,composition,puppeteerInstance:browser,output:here+`out/${id.toLowerCase()}-${label}.png`,frame:Math.round(seconds*30)});
  console.log(`${id} complete: ${data.videos[id].duration}s`);
 }
}finally{await browser.close({silent:false});}
