import type {Env} from './env';

/** Bounded cron housekeeping; `now` is epoch milliseconds, never a billing-clock override. */
export async function runMvpMaintenance(env:Pick<Env,'AGENT_DB'>,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime()))throw new TypeError('Invalid maintenance time.');
 const timestamp=new Date(now).toISOString(),completedBefore=new Date(now-7*86400000).toISOString();
 const results=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`DELETE FROM mayor_rate_limits WHERE rowid IN (
   SELECT rowid FROM mayor_rate_limits WHERE
    (subject LIKE 'phone-verify:%' AND bucket<?)
    OR (subject LIKE 'custom:%:day' AND bucket<?)
    OR (subject NOT LIKE 'phone-verify:%' AND subject NOT LIKE 'custom:%:day' AND bucket<?)
   ORDER BY rowid LIMIT 500)`)
   .bind(Math.floor(now/3600000)-48,Math.floor(now/86400000)-2,Math.floor(now/60000)-2880),
  env.AGENT_DB.prepare(`UPDATE mayor_custom_tool_proposals SET ciphertext='' WHERE rowid IN (
   SELECT rowid FROM mayor_custom_tool_proposals WHERE state='prepared' AND expires_at<=? AND ciphertext<>''
   ORDER BY rowid LIMIT 500)`).bind(timestamp),
  env.AGENT_DB.prepare(`UPDATE mayor_custom_tool_proposals SET result_json=NULL WHERE rowid IN (
   SELECT rowid FROM mayor_custom_tool_proposals WHERE state='completed' AND created_at<? AND result_json IS NOT NULL
   ORDER BY rowid LIMIT 500)`).bind(completedBefore),
 ]);
 return {rateLimitsDeleted:results[0].meta.changes,expiredPreparedPayloadsCleared:results[1].meta.changes,completedResultsCleared:results[2].meta.changes};
}
