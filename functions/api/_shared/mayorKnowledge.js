import { mayorPages } from './mayorSiteKnowledge.js';
export const mayorPaths=mayorPages.map(p=>p.path);
export const mayorNavigationPaths=[...mayorPaths,'https://mayor.mehyar.us'];
const sectors='Enterprise sectors: technology knowledge/support/incident drafts from approved sources; healthcare administrative intake and staff handoff, no clinical decisions; pharma controlled document versions, traceability, quality review and change control, no validated compliance claim; finance approved policy/product knowledge and operational drafts, no lending/investment decisions; enterprise operations across teams with roles, monitoring, failure recovery and support ownership.';
const catalogNames=['Designful','HustleKit','TikTok Growth System','Sprint30','PrepGuide','TrueSketch','BizBuilder','CreditFix Kit','PLR Vault','FreelancerOS','PromptPack Pro'];
function relevantExcerpt(text,words,catalogMatches=[]) {
  if(text.length<=4500)return text;
  const lines=text.split('\n');
  const matches=lines.map((line,index)=>({index,score:words.reduce((sum,word)=>sum+(line.toLowerCase().includes(word)?1:0),0)+catalogMatches.reduce((sum,name)=>sum+(line.toLowerCase().includes(name)?100:0),0)})).filter(match=>match.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
  if(!matches.length)return text.slice(0,4500);
  const used=new Set();
  const excerpts=matches.map(({index})=>{const start=Math.max(0,index-1);if(used.has(start))return '';used.add(start);return lines.slice(start,index+5).join('\n').slice(0,900);}).filter(Boolean);
  return `${text.slice(0,700)}\n\nRelevant sections from this same page:\n${excerpts.join('\n\n')}`.slice(0,4500);
}
export function mayorKnowledge(messages,page='/') {
  const product=mayorPages.find(p=>p.path==='/mayor')?.text||'';
  const plans=mayorPages.find(p=>p.path==='/pricing')?.text||'';
  const query=messages.filter(m=>m.role==='user').slice(-3).map(m=>m.content).join(' ').toLowerCase();
  const catalogMatches=catalogNames.map(name=>name.toLowerCase()).filter(name=>query.includes(name));
  const words=[...new Set(query.match(/[a-z]{4,}/g)||[])].filter(w=>!['show','what','would','could','about','with','that','this','have','make','from','your','business','please','price','pricing','cost','plans','monthly','need','help','which','tell','does','work'].includes(w));
  const ranked=mayorPages.filter(p=>!['/','/services'].includes(p.path)).map(p=>({p,score:(p.path===page?12:0)+(p.path==='/apps'&&catalogMatches.length?40:0)+words.reduce((sum,w)=>sum+(p.path.includes(w)?8:0)+(p.title.toLowerCase().includes(w)?5:0)+(p.text.toLowerCase().includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score).filter(x=>x.score>0).slice(0,3);
  return `Current public site directory (use exact paths for navigation, not made-up URLs):\n${mayorPages.map(p=>`${p.path} — ${p.title}`).join('\n')}\n\nThe Mayor product and account path:\n${product.slice(0,2500)}\n\nPublic launch plans:\n${plans.slice(plans.indexOf('The Mayor'),plans.indexOf('Discovery')).slice(0,3500)}\n\nAll core solutions and capabilities:\n${mayorPages.find(p=>p.path==='/services')?.text||''}\n\n${sectors}\n\nRelevant public page detail:\n${ranked.map(({p})=>`${p.path} — ${relevantExcerpt(p.text,words,catalogMatches)}`).join('\n\n')}`;
}
