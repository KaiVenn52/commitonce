import assert from 'node:assert/strict';
export function validatePortalDuration(id,duration){
 assert.ok(['PortalPitch','PortalDemo'].includes(id),'Unknown portal composition');
 assert.ok(Number.isFinite(duration)&&duration>0,'Media duration must be finite and positive');
 assert.ok(duration<=(id==='PortalPitch'?120:180),'Media exceeds actual portal limit');
}
export function validateTerminalLines(log,scenes){
 assert.ok(scenes.length>0,'Missing terminal scenes');
 for(const scene of scenes){
  assert.equal(scene.terminal,true,'Portal demo must display real terminal output');
  assert.ok(scene.visual.length>0,'Empty terminal scene');
  for(const line of scene.visual)assert.ok(log.includes(line),'Invented terminal line');
 }
}
export function validateCapture(session){
 assert.equal(session.exitCode,0,'Live demo must exit successfully');
 const text=session.chunks.map(c=>c.text).join('');
 const a=text.indexOf('Scenario A —'),b=text.indexOf('Scenario B —');
 assert.ok(a>=0&&b>a,'Both scenarios must be present in order');
 assert.match(text.slice(a,b),/counter onchain 2/,'Unguarded counter must reach 2');
 assert.match(text.slice(b),/counter onchain 1/,'Guarded counter must remain 1');
 assert.match(text.slice(b),/FAILED — AlreadyCommitted/,'Guarded retry must fail for the claimed reason');
 assert.match(text,/both scenarios behaved exactly as claimed/,'Runner must affirm its assertions');
 return text;
}
