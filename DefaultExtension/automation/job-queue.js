export class JobQueue { constructor(){this.jobs=[];} enqueue(job){if(this.jobs.some(x=>x.id===job.id)) throw new Error('Duplicate job'); this.jobs.push(job);} next(){return this.jobs.shift();} }
