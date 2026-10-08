import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('./',import.meta.url));
const url=await bundle({entryPoint:here+'index.tsx',publicDir:here+'public'});
for(const id of ['Pitch','Demo']){
 let lastPercent=-1;
 const composition=await selectComposition({serveUrl:url,id});
 for(const [label,seconds] of [['opening',3],['proof',id==='Pitch'?100:65],['closing',composition.durationInFrames/30-4]])await renderStill({serveUrl:url,composition,output:here+`out/${id.toLowerCase()}-${label}.png`,frame:Math.min(composition.durationInFrames-1,Math.round(seconds*30))});
 await renderMedia({serveUrl:url,composition,codec:'h264',crf:18,colorSpace:'bt709',outputLocation:here+`out/${id.toLowerCase()}.mp4`,concurrency:3,onProgress:({progress})=>{const percent=Math.floor(progress*10)*10;if(percent!==lastPercent){lastPercent=percent;console.log(`${id} ${percent}%`);}}});
 console.log(`${id} rendered`);
}
