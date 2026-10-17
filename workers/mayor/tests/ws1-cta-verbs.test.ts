import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';

/* WS1 build 3 (2026-10-17): the CTA verb census. The redesign spec
 * rules ONE primary verb for starting — "Start free" — everywhere.
 * The 2026-10-17 census found it already uniform (46 uses, zero
 * rivals across web/ + src/); this pin keeps it that way. */
const RIVALS=['Get started','Try it free','Try free','Start your free','Claim your','Sign up free','Start now'];
function* sources(dir:string):Generator<string>{
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=dir+'/'+entry.name;
  if(entry.isDirectory())yield* sources(path);
  else if(/\.(html|ts|tsx)$/.test(entry.name))yield readFileSync(path,'utf8');
 }
}
describe('CTA verb system',()=>{
 it('the primary start verb is "Start free" with no rival verbs anywhere',()=>{
  const all=[...sources('web'),...sources('src')].join('\n');
  expect(all).toContain('Start free');
  for(const rival of RIVALS)expect(all).not.toContain(rival);
 });
});
