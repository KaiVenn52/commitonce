// The live portal on 2026-10-11 caps the pitch at two minutes, overriding the older FAQ.
// Preserve the original Pitch and Demo media; create a separately named pitch composition.
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('./',import.meta.url));
const data=JSON.parse(await readFile(here+'public/data.json'));
const rows=[
 ['A retry is a new transaction.','A Solana client times out, rebuilds with a fresh blockhash, and retries. Both attempts can land because the runtime sees different message bytes. I am Kai Venn, a university engineering student and solo founder. CommitOnce gives Solana applications an onchain idempotency key for this logical intent.', ['Timeout → rebuild → retry','New bytes. Same logical intent.','Kai Venn · solo engineering-student founder']],
 ['Commit the intent atomically.','Prepend claim to the same atomic transaction as the business instructions. It creates a receipt keyed by authority, namespace, and intent key. A duplicate aborts the transaction. If the business action fails, the receipt rolls back. The guarantee is at-most-once successful execution of a guarded logical intent within the configured retention window. It does not guarantee that the first attempt lands.', ['claim → business instruction','Business failure → receipt rolls back','At-most-once within the retention window']],
 ['Proved on devnet.','Both programs run on devnet. Without the guard, two rebuilt transactions execute and the counter reaches two. With it, the second fails with Already Committed and the counter stays one. The public repository includes real transaction links, sixty Rust tests, seventy nine SDK tests, and reproducible verification.',data.videos.Pitch.scenes[3].visual],
 ['Payments first. Validate demand.','We start with payments, checkout and billing teams whose retry paths lack intent protection. Next, inspect those paths with ten potential design partners and measure integration overhead. That is a validation plan, not existing adoption.', ['Payments teams with unsafe retries','Ten potential design-partner conversations','A plan, not existing customers']],
 ['Honest limits. Practical next steps.','I led this build with AI coding assistance. The receipt mechanism is prior art; the contribution is the security model and developer tooling. There is no mainnet deployment, audit, npm release, user, revenue or financing. Next: validate demand, publish the SDK, and audit before production use.', ['Founder-led · AI-assisted development','Devnet only · unaudited · no traction','Validate demand → SDK release → audit']]
];
const stamp=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`};
let time=0,srt='',n=1;const scenes=[];
for(let i=0;i<rows.length;i++){
 const [title,text,visual]=rows[i],asset=`portalpitch-${i}.mp3`,input=here+`public/PortalPitch-${i}.txt`;
 await writeFile(input,text);
 execFileSync('edge-tts',['--voice','en-US-GuyNeural','--rate','+8%','--file',input,'--write-media',here+'public/'+asset],{stdio:'inherit',timeout:120000});
 const audioSeconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',here+'public/'+asset],{encoding:'utf8'}));
 const duration=Math.ceil((audioSeconds+1)*30)/30,words=text.split(/\s+/),captions=[];
 for(let k=0;k<words.length;k+=8){const start=k/words.length*audioSeconds,end=Math.min((k+8)/words.length*audioSeconds,audioSeconds),text=words.slice(k,k+8).join(' ');captions.push({start,end,text});srt+=`${n++}\n${stamp(time+start)} --> ${stamp(time+end)}\n${text}\n\n`;}
 scenes.push({title,text,visual,asset,audioSeconds,duration,start:time,captions,terminal:i===2});time+=duration;
}
if(!Number.isFinite(time)||time>=120)throw new Error(`Portal pitch must be under 120s; got ${time}`);
data.videos.PortalPitch={duration:time,scenes};
await writeFile(here+'public/data.json',JSON.stringify(data,null,2));
await writeFile(here+'out/portalpitch.srt',srt);
console.log(`PortalPitch: ${time}s; original 164s Pitch retained as historical artifact.`);
