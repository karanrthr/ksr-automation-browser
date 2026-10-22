export function alreadyHandled(job,fingerprint){return job.completed.includes(fingerprint)||job.inFlight===fingerprint||job.skipped.includes(fingerprint);}
export function safeProjectName(value){return (value||'Gemini Project').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().slice(0,80)||'Gemini Project';}
