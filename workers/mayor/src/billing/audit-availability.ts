/**
 * audit-availability.ts — the hub Audit pause state, read at serve time.
 *
 * The hub (mehyar.us Pages) serves a read-only availability probe at
 * /api/pay/availability whose `audit_paused` flag is the single source
 * of truth for the claim-posture pause on paid Audit checkouts (set
 * true by the pause commit on the hub; the unpause commit flips it to
 * false after verifying the generation cure end to end). The homepage
 * audit band keys its paused annotation off this flag, so the note
 * retires itself the moment the hub unpauses — no second edit here.
 *
 * Semantics are fail-safe by construction: ONLY an affirmative
 * `audit_paused === false` in a fresh, well-formed response clears
 * the annotation. A missing flag, a non-200, malformed JSON, or a
 * network failure/timeout all read as PAUSED (annotation shown).
 * While the pause is in force that is the truthful default: a stale
 * "paused" note lingering briefly after an unpause is a smaller harm
 * than sending a visitor into a paused checkout unannounced.
 *
 * The read is cached per isolate (60s on success, 30s on failure) so
 * the home route pays at most one short-timeout fetch per minute;
 * the worst case after a real unpause is the note surviving one TTL.
 */
export const AUDIT_AVAILABILITY_URL='https://mehyar.us/api/pay/availability';
const SUCCESS_TTL_MS=60_000;
const FAILURE_TTL_MS=30_000;
const FETCH_TIMEOUT_MS=1_500;

let cached:{paused:boolean;expires:number}|null=null;

/** Test seam: drop the per-isolate cache between cases. */
export function resetAuditPausedCache():void{cached=null;}

/**
 * True while the hub Audit checkouts are paused. `now` and
 * `fetchImpl` are injectable for tests; production calls it bare.
 */
export async function auditPaused(now:number=Date.now(),fetchImpl:typeof fetch=fetch):Promise<boolean>{
  if(cached&&now<cached.expires)return cached.paused;
  try{
    const res=await fetchImpl(AUDIT_AVAILABILITY_URL,{headers:{accept:'application/json'},signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
    if(!res.ok)throw new Error(`audit availability answered ${res.status}`);
    const body=await res.json() as {audit_paused?:unknown}|null;
    // Only an affirmative false clears the annotation.
    const paused=body?.audit_paused!==false;
    cached={paused,expires:now+SUCCESS_TTL_MS};
    return paused;
  }catch{
    cached={paused:true,expires:now+FAILURE_TTL_MS};
    return true;
  }
}
