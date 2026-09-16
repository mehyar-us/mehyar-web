export default function BillingCheck({report}:{report:unknown}){
  if(report===null||report===undefined)return null;
  const r=report as {state:string;checkedAt:string|null;stale:boolean;issues:string[]};
  const valid=r&&['checking','checked','needs_review','failed','unavailable'].includes(r.state)&&typeof r.stale==='boolean'&&(r.checkedAt===null||typeof r.checkedAt==='string'&&Number.isFinite(Date.parse(r.checkedAt)))&&Array.isArray(r.issues)&&r.issues.length<=30&&r.issues.every(s=>typeof s==='string'&&s.length<=300);
  if(!valid)return <section className="panel" aria-label="Billing record check"><h2>Billing check unavailable</h2><p>Refresh billing status to try again.</p></section>;
  const title=r.state==='needs_review'?'Billing records need review':r.state==='checking'?'Billing check in progress':r.state==='failed'||r.state==='unavailable'?'Billing check could not finish':r.stale?'Last billing check is out of date':'No differences found in the last billing check';
  return <section className="panel" aria-label="Billing record check"><h2>{title}</h2>
    <p>This check covers your subscription and latest invoice. Refunds, credits and older invoices may need separate review.</p>
    {r.checkedAt&&<p>Last completed check: <time dateTime={r.checkedAt}>{new Date(r.checkedAt).toLocaleString()}</time></p>}
    {r.issues.length>0&&<><p>{['checking','failed','unavailable'].includes(r.state)?'Findings from the previous completed check:':'Findings to review:'}</p><ul>{r.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></>}
    {r.stale&&r.state!=='checked'&&r.checkedAt&&<p>These findings are more than a day old.</p>}
  </section>;
}
