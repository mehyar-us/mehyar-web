import {Parser} from 'htmlparser2';
import {decodeMailBody,type MailBody} from './mail-body';
import type {MailSnapshot} from './mail-snapshot';
import {z} from 'zod';

export type MailText={version:1;text:string;trustedForInstructions:false;
  omissions:(MailBody['omissions'][number]|'html_nontext'|'html_visibility_unresolved'|'text_limit'|'html_limit'|'controls_removed')[]};
export const mailTextSchema=z.object({version:z.literal(1),text:z.string().max(32000).refine(value=>new TextEncoder().encode(value).length<=32000),
  trustedForInstructions:z.literal(false),omissions:z.array(z.enum(['attachment','external_body','unsupported_mime','invalid_part','invalid_encoding','limit',
    'html_nontext','html_visibility_unresolved','text_limit','html_limit','controls_removed'])).max(12)}).strict();
const ignored=new Set(['head','script','style','template','noscript','iframe','object','embed','svg','math']);
const breaks=new Set(['address','article','aside','blockquote','br','div','dl','dt','dd','fieldset','figcaption','figure','footer','h1','h2','h3','h4','h5','h6','header','hr','li','main','nav','ol','p','pre','section','table','tr','ul']);

/** Text projection only, not HTML sanitization or a claim of browser visibility.
 * No URLs, images, CSS or attachments are fetched. Quoted mail and any instructions
 * it contains remain untrusted source data, never an automation policy. */
export function extractMailText(snapshot:MailSnapshot):MailText {
  const body=decodeMailBody(snapshot),omissions=new Set<MailText['omissions'][number]>(body.omissions);
  let text='',used=0,capped=false;
  const append=(value:string)=>{
    if(capped)return;
    const clean=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
    if(clean!==value)omissions.add('controls_removed');
    const size=new TextEncoder().encode(clean).length;
    if(used+size<=32000){text+=clean;used+=size;return;}
    omissions.add('text_limit');
    for(const character of clean){const n=new TextEncoder().encode(character).length;if(used+n>32000)break;text+=character;used+=n;}
    capped=true;
  };
  for(const block of body.blocks){
    if(text)append('\n');
    if(block.format==='text'){append(block.content);continue;}
    const hidden:boolean[]=[];
    let nodes=0,stopped=false;
    const parser=new Parser({
      onopentag(name,attrs){
        if(stopped)return;
        if(++nodes>4096||hidden.length>=128){omissions.add('html_limit');stopped=true;parser.pause();return;}
        const excluded=ignored.has(name)||Object.hasOwn(attrs,'hidden')||attrs['aria-hidden']?.toLowerCase()==='true';
        if(excluded)omissions.add('html_nontext');
        if(Object.hasOwn(attrs,'style')||Object.hasOwn(attrs,'class'))omissions.add('html_visibility_unresolved');
        const suppressed=hidden.at(-1)===true||excluded;
        hidden.push(suppressed);
        if(!suppressed){if(breaks.has(name))append('\n');else if(name==='td'||name==='th')append('\t');}
      },
      ontext(value){if(!stopped&&!hidden.at(-1))append(value);},
      onclosetag(name){if(stopped)return;const suppressed=hidden.pop();if(!suppressed&&breaks.has(name)&&name!=='br'&&name!=='hr')append('\n');},
    },{decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true,xmlMode:false});
    parser.end(block.content);
  }
  return {version:1,text:text.replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(),omissions:[...omissions],trustedForInstructions:false};
}
