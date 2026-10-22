/**
 * desk-golden.test.ts — the Desk golden-render suite (Reinvention
 * Slice 1, blueprint §3.2 "Testing: golden renders for the catalog").
 *
 * Every primitive's rendered output is pinned by a golden file under
 * tests/golden/. The MONEY fixtures are catalog-fed in shape: the
 * founding price label and seat counts are exactly what the Desk
 * builds from the public catalog ($79.20/mo founding locked for
 * life, seats from foundingSeats()) — the point of the suite is that
 * money copy can only change by a deliberate golden update, never
 * by an accidental code drift.
 *
 * Regenerate after a deliberate change:
 *   UPDATE_GOLDEN=1 npx vitest run tests/desk-golden.test.ts
 *
 * The degradation contract is pinned too: an unknown intent type and
 * a newer-version MONEY intent both render as a non-actionable Line
 * carrying only the intent's summary — no button, no control.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {DeskStrip} from '../web/desk/desk';
import {Bar,IntentView} from '../web/desk/primitives';
import type {DeskIntent} from '../web/desk/intents';

const GOLDEN_DIR=new URL('./golden/',import.meta.url);

const FOUNDING_PRICE='$79.20/mo · locked for life';

function ribbon(partial:Partial<Extract<DeskIntent,{type:'intent-ribbon'}>>):DeskIntent{
  return {id:'ribbon-founding',version:1,type:'intent-ribbon',planRef:'founding',state:'carried',
    headline:"Founding — you're headed here.",
    detail:"We'll set up your shop first, then open this exact plan. Nothing to pay yet.",
    priceLabel:FOUNDING_PRICE,seats:{remaining:22,total:25},
    summary:"Founding — you're headed here. We'll set up your shop first, then open this exact plan.",
    ...partial} as DeskIntent;
}

const FIXTURES:Record<string,()=>string>={
  'ribbon-carried-catalog':()=>renderToStaticMarkup(createElement(IntentView,{intent:ribbon({})})),
  'ribbon-carried-failquiet':()=>renderToStaticMarkup(createElement(IntentView,{intent:ribbon({priceLabel:undefined,seats:null})})),
  'ribbon-unhonorable-soldout':()=>renderToStaticMarkup(createElement(IntentView,{intent:ribbon({state:'unhonorable',headline:'Founding just filled',detail:'Every founding seat is claimed. The standard plan is the way in now — same Mayor, standard price.',alternativeLabel:'Pro — $99/mo',seats:null,summary:'Founding just filled. The standard plan is the way in now.'})})),
  'seats-line-live':()=>renderToStaticMarkup(createElement(IntentView,{intent:{id:'seats',version:1,type:'seats-line',priceLabel:FOUNDING_PRICE,seats:{remaining:22,total:25},soldOut:false,summary:'Founding — $79.20/mo · locked for life · 22 of 25 seats left'}})),
  'seats-line-failquiet':()=>renderToStaticMarkup(createElement(IntentView,{intent:{id:'seats',version:1,type:'seats-line',priceLabel:FOUNDING_PRICE,seats:null,soldOut:false,summary:'Founding pricing, while seats last'}})),
  'seats-line-soldout':()=>renderToStaticMarkup(createElement(IntentView,{intent:{id:'seats',version:1,type:'seats-line',priceLabel:FOUNDING_PRICE,seats:{remaining:0,total:25},soldOut:true,summary:'Founding is full'}})),
  'receipt-founding':()=>renderToStaticMarkup(createElement(IntentView,{intent:{id:'receipt-1',version:1,type:'receipt',text:"Founding — you're in.",detail:'$79.20/mo · locked for life while this subscription stays active.',summary:"Founding — you're in."}})),
  'morning-line':()=>renderToStaticMarkup(createElement(DeskStrip,{snapshot:{signedIn:true,businessName:'Bright Cuts',statusLine:'Open today · 9:00–18:00',stats:[{label:'Bookings today',value:'3'},{label:'Waiting on you',value:'1'},{label:'Open tasks',value:'2'}],intents:[]},callbacks:{}})),
  'primitives-sampler':()=>renderToStaticMarkup(createElement(DeskStrip,{snapshot:{signedIn:true,businessName:'Bright Cuts',intents:[
    {id:'l1',version:1,type:'line',text:'Dana asked to move to Friday — draft ready.',summary:'Dana asked to move to Friday.'},
    {id:'f1',version:1,type:'fact',label:'Walk-in rate',value:'$45',qualifier:'weekdays',copyable:true,summary:'Walk-in rate: $45 (weekdays)'},
    {id:'p1',version:1,type:'person',name:'Dana Ruiz',context:'Haircut · 10:30',state:'new',summary:'Dana Ruiz — Haircut · 10:30'},
    {id:'c1',version:1,type:'chip',label:'Today',count:3,selected:true,summary:'Today (3)'},
    {id:'s1',version:1,type:'skeleton',shape:'card',summary:'Loading'},
    {id:'e1',version:1,type:'empty',text:'Nothing else needs you.',summary:'Nothing else needs you.'},
    {id:'x1',version:1,type:'inline-error',text:'The calendar did not answer.',retryLabel:'Try again',summary:'The calendar did not answer.'},
  ]},callbacks:{}})),
  'bar':()=>renderToStaticMarkup(createElement(Bar,{})),
  'door-stream':()=>renderToStaticMarkup(createElement(DeskStrip,{snapshot:{signedIn:true,businessName:'Bright Cuts',statusLine:'Open today · 9:00–18:00',stats:[{label:'Bookings today',value:'3'},{label:'Waiting on you',value:'0'},{label:'Open tasks',value:'0'}],intents:[
    ribbon({}),
    {id:'receipt-1',version:1,type:'receipt',text:"Founding — you're in.",detail:'$79.20/mo · locked for life while this subscription stays active.',summary:"Founding — you're in."},
    {id:'p1',version:1,type:'person',name:'Dana Ruiz',context:'Haircut · 10:30',state:'known',summary:'Dana Ruiz — Haircut · 10:30'},
  ]},callbacks:{}})),
  'signed-out-strip':()=>renderToStaticMarkup(createElement(DeskStrip,{snapshot:{signedIn:false,businessName:'The Mayor',statusLine:'Mayor. Talk to your business.',intents:[ribbon({})]},callbacks:{}})),
};

function diffSummary(expected:string,actual:string):string{
  const a=expected.split('\n');const b=actual.split('\n');
  const lines:string[]=[];
  for(let i=0;i<Math.max(a.length,b.length)&&lines.length<12;i++){
    if(a[i]!==b[i])lines.push(`line ${i+1}:\n  golden: ${a[i]??'<missing>'}\n  actual: ${b[i]??'<missing>'}`);
  }
  return lines.join('\n')||'(outputs differ only in trailing whitespace)';
}

describe('Desk golden renders (catalog v1)',()=>{
  for(const [name,render] of Object.entries(FIXTURES)){
    it(`pins ${name}`,()=>{
      const actual=render();
      const file=new URL(`${name}.html`,GOLDEN_DIR);
      if(process.env.UPDATE_GOLDEN==='1'){
        mkdirSync(GOLDEN_DIR,{recursive:true});
        writeFileSync(file,`${actual}\n`);
        return;
      }
      if(!existsSync(file))throw new Error(`golden missing for ${name} — run UPDATE_GOLDEN=1 npx vitest run tests/desk-golden.test.ts`);
      const expected=readFileSync(file,'utf8').replace(/\n$/,'');
      if(actual!==expected)throw new Error(`golden mismatch for ${name}:\n${diffSummary(expected,actual)}\nIf this change is deliberate, regenerate: UPDATE_GOLDEN=1 npx vitest run tests/desk-golden.test.ts`);
    });
  }
});

describe('Desk degradation contract (§3.2)',()=>{
  it('an unknown intent type renders as a Line carrying only its summary',()=>{
    const html=renderToStaticMarkup(createElement(IntentView,{intent:{id:'x',type:'action-card',version:1,summary:'Dana asked to move to Friday — draft ready.'}}));
    expect(html).toContain('desk-line');
    expect(html).toContain('Dana asked to move to Friday — draft ready.');
    expect(html).not.toContain('<button');
  });
  it('a newer-version MONEY intent degrades non-actionably (no controls, summary only)',()=>{
    const html=renderToStaticMarkup(createElement(IntentView,{intent:{id:'r',type:'intent-ribbon',version:2,summary:'Founding — $79.20/mo, locked for life.'}}));
    expect(html).toContain('Founding — $79.20/mo, locked for life.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('desk-ribbon');
  });
  it('a malformed intent renders the generic safe line, never a crash',()=>{
    const html=renderToStaticMarkup(createElement(IntentView,{intent:{id:'m',type:'line',version:1} as never}));
    expect(html).toContain('Open The Mayor to review.');
  });
});
