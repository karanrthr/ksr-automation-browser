const KEY='geminiCurrentChatJob';
export async function loadJob(){return (await chrome.storage.local.get(KEY))[KEY]||null;}
export async function saveJob(job){job.updatedAt=new Date().toISOString();await chrome.storage.local.set({[KEY]:job});return job;}
export async function transition(job,state,detail=''){job.state=state;job.currentAction=detail;return saveJob(job);}
export async function clearJob(){await chrome.storage.local.remove(KEY);}
