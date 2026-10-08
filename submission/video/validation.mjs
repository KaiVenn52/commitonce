import assert from 'node:assert/strict';
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
