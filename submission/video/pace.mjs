// Capture-only pacing: preserve every request and response, avoid bursting a shared RPC.
const originalFetch=globalThis.fetch;
let queue=Promise.resolve();
globalThis.fetch=(...args)=>{
  const run=queue.then(async()=>{await new Promise(resolve=>setTimeout(resolve,700));return originalFetch(...args);});
  queue=run.catch(()=>{});
  return run;
};
