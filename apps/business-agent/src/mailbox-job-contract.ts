export const jobStates={queued:'Waiting to run',running:'Analyzing a section',completed:'Sections complete',review_required:'Needs review',cancelled:'Stopped',expired:'Approval expired'};
export type MailboxJob={id:string;status:keyof typeof jobStates;completedSections:number;totalSections:number;maximumTextCredits:number;createdAt:string;approvalExpiresAt:string;
  source:{streamId:string;messageId:string;receipt:string};reason:string|null;includesAggregation:false;authorizesExternalActions:false};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function validMailboxJob(v:unknown):v is MailboxJob{
  const j=v as MailboxJob|null;
  return !!j&&uuid(j.id)&&Object.hasOwn(jobStates,j.status)&&Number.isInteger(j.totalSections)&&j.totalSections>=1&&j.totalSections<=32
    &&Number.isInteger(j.completedSections)&&j.completedSections>=0&&j.completedSections<=j.totalSections
    &&(j.status==='completed'?j.completedSections===j.totalSections:!['queued','running'].includes(j.status)||j.completedSections<j.totalSections)
    &&j.maximumTextCredits===j.totalSections&&typeof j.createdAt==='string'&&typeof j.approvalExpiresAt==='string'
    &&Number.isFinite(Date.parse(j.createdAt))&&Date.parse(j.approvalExpiresAt)-Date.parse(j.createdAt)===86400000
    &&!!j.source&&[j.source.streamId,j.source.messageId].every(v=>typeof v==='string'&&v.length>0&&v.length<=2048)&&uuid(j.source.receipt)
    &&(j.reason===null||typeof j.reason==='string'&&j.reason.length<=128)&&j.includesAggregation===false&&j.authorizesExternalActions===false;
}
export function validMailboxJobs(v:unknown):v is {jobs:MailboxJob[];nextCursor?:string}{
  const p=v as {jobs:unknown[];nextCursor?:string}|null;
  return !!p&&Array.isArray(p.jobs)&&p.jobs.length<=10&&p.jobs.every(validMailboxJob)&&new Set(p.jobs.map(j=>j.id)).size===p.jobs.length&&(p.nextCursor===undefined||uuid(p.nextCursor));
}
