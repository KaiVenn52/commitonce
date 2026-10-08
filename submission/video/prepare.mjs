import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCapture} from './validation.mjs';
const here=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
await mkdir(here+'public',{recursive:true}); await mkdir(here+'out',{recursive:true});
const session=JSON.parse(await readFile(here+'public/session.json','utf8'));
const log=validateCapture(session);
const lines=log.split(/\r?\n/);
const a=log.indexOf('Scenario A —'),b=log.indexOf('Scenario B —');
const excerpt=text=>text.split(/\r?\n/).filter(l=>/^\s*(attempt |changed {2,}|unchanged {2,}|priority fee {2,}|signature {2,}|instructions {2,}|outcome {2,}|counter onchain |count {2,}|status {2,}|commit_once {2,}|demo_counter {2,}|cluster {2,})/.test(l)).map(l=>l.trim());
const proofA=excerpt(log.slice(a,b));const proofB=excerpt(log.slice(b));
if(!proofA.some(x=>x==='counter onchain 2')||!proofB.some(x=>x==='counter onchain 1')||!log.includes('AlreadyCommitted'))throw new Error('Capture lacks A/B proof.');
const pitch=(await readFile(root+'submission/PITCH_SCRIPT.md','utf8')).split(/### §[1-6] —/).slice(1,7).map(section=>section.split(/\r?\n/).filter(l=>l.startsWith('> ')).map(l=>l.slice(2)).join(' ').replaceAll('`',''));
if(pitch.length!==6)throw new Error('Expected six pitch sections.');
const titles=['A retry can execute twice.','New bytes. Same intent.','One atomic transaction.','Verified, not assumed.','Start with payment retries.','Honest status. Next steps.'];
const visuals=[['Timeout → rebuild → retry','Both attempts may land'],['Runtime: message-hash dedup','Application: logical-intent dedup'],['claim → business instruction','Duplicate receipt → transaction aborts','At-most-once within the retention window'],proofA.slice(-5).concat(proofB.filter(x=>/outcome|counter onchain/.test(x)).slice(-4)),['Payments teams without intent protection','Inspect ten potential design-partner retry paths','Validation plan, not existing customers'],['Devnet only · unaudited','No users · no revenue · npm unpublished','Founder-led · AI-assisted engineering']];
const demo=[
['Two rebuilt sends. One intent.','This is a recorded Solana devnet demonstration, captured on October eighth. The terminal output you will see is an edited replay of a real run, with waiting time removed. Without the guard, the counter reaches two. With CommitOnce, it remains one. The complete recording and transaction links are published beside this video.',excerpt(log.slice(0,a)).slice(0,4)],
['Fresh state for each scenario.','Both programs are already deployed on devnet. The business program is a simple counter and knows nothing about CommitOnce. Each scenario gets a fresh authority and a fresh counter. The runner verifies the instruction discriminators before sending. We are demonstrating execution behavior, not a real customer payment.', ['Solana devnet · two deployed programs','Fresh authority → fresh counter','Business program unchanged']],
['Without the guard: both land.','Here is scenario A. The first transaction increments the counter. The retry uses a fresh blockhash, raises the priority fee, and has a different signature. Its semantic intent is unchanged. Both transactions succeed. The onchain counter is two. Runtime deduplication cannot protect this rebuilt intent because the message bytes are different.',proofA],
['With the guard: retry blocked.','Now scenario B adds claim before the same business instruction. Attempt one succeeds and creates the receipt. The rebuilt retry finds that receipt. Already Committed, error six thousand, aborts the transaction. The counter remains one. The second attempt is a real submitted transaction that fails onchain, not a mocked rejection.',proofB],
['Same transaction. Atomic rollback.','The receipt is keyed by authority, namespace, and idempotency key. Claim and the business action belong to the same atomic transaction. If the business instruction fails, the receipt creation rolls back too. Successful retries must reuse the same intent key and follow the same guarded path. Unguarded paths remain unprotected.',['claim → business instruction','Business failure → receipt rolls back','Guard every execution path']],
['Protection has a boundary.','The guarantee is at most once successful execution of a guarded logical intent within the configured retention window. It prevents a second successful execution; it does not guarantee the first lands. After expiry and receipt cleanup, the key can be used again. This distinction is deliberate, not an exactly once promise.',['At-most-once successful execution','Within the configured retention window','No delivery guarantee']],
['Reproduce the result.','The repository includes the open source program, TypeScript SDK, setup instructions, compiled artifact tests, and this runnable demo. Sixty Rust tests and seventy nine SDK tests pass. The programs are devnet only and unaudited. Open the repository to inspect the full terminal capture and the actual explorer links.',['60 Rust tests · 79 SDK tests','Devnet only · unaudited','github.com/KaiVenn52/commitonce']]
];
const stamp=seconds=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
const output={date:session.date,disclosure:'Synthetic English narration · edited replay of actual devnet output',videos:{}};
for(const [id,rows] of [['Pitch',pitch.map((text,i)=>[titles[i],text,visuals[i]])],['Demo',demo]]){
 let time=0,srt='',index=1;const scenes=[];
 for(let i=0;i<rows.length;i++){
  const [title,text,visual]=rows[i],asset=`${id.toLowerCase()}-${i}.mp3`;
  const speech=text.replaceAll('commit_once::claim','Commit Once claim'),speechPath=here+`public/${id}-${i}.txt`;
  if(process.argv.includes('--reuse-audio')){
   if(await readFile(speechPath,'utf8')!==speech)throw new Error('Cannot reuse audio for changed narration');
   await access(here+'public/'+asset);
  }else{
   await writeFile(speechPath,speech);
   execFileSync('edge-tts',['--voice','en-US-GuyNeural','--rate','+8%','--file',speechPath,'--write-media',here+'public/'+asset],{stdio:'inherit',timeout:120000});
  }
  const audioSeconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',here+'public/'+asset],{encoding:'utf8'}));
  if(!Number.isFinite(audioSeconds)||audioSeconds<=0)throw new Error('Invalid speech duration');
  const duration=Math.ceil((audioSeconds+1.0)*30)/30;
  const words=text.split(/\s+/),captions=[];for(let k=0;k<words.length;k+=8){const start=k/words.length*audioSeconds,end=Math.min((k+8)/words.length*audioSeconds,audioSeconds);const caption=words.slice(k,k+8).join(' ');captions.push({start,end,text:caption});srt+=`${index++}\n${stamp(time+start)} --> ${stamp(time+end)}\n${caption}\n\n`;}
  scenes.push({title,text,visual,asset,audioSeconds,duration,start:time,captions,terminal:id==='Demo'&&(i===2||i===3)||id==='Pitch'&&i===3});time+=duration;
 }
 if(time>=180||(id==='Pitch'&&time<120))throw new Error(`${id} duration ${time}s outside required limit`);
 output.videos[id]={duration:time,scenes};await writeFile(here+`out/${id.toLowerCase()}.srt`,srt);
}
await copyFile(root+'assets/brand/commitonce-mark-transparent.svg',here+'public/logo.svg');
await writeFile(here+'public/data.json',JSON.stringify(output,null,2));
const signatures=lines.filter(l=>/^\s*signature\s+/.test(l)).map(l=>l.trim().split(/\s+/)[1]);
await writeFile(here+'out/transaction-links.txt',signatures.map(s=>`https://explorer.solana.com/tx/${s}?cluster=devnet`).join('\n')+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(output.videos).map(([k,v])=>[k,v.duration]))));
