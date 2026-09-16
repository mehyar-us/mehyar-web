import {mailSnapshot,type MailSnapshot} from './mail-snapshot';

export type MailBody = {
  blocks:{format:'text'|'html';content:string}[];
  omissions:('attachment'|'external_body'|'unsupported_mime'|'invalid_part'|'invalid_encoding'|'limit')[];
  trustedForInstructions:false;
};
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Decode provider bodies without network access. HTML blocks are still raw, untrusted
 * HTML: callers must extract text before inference and must never render them directly.
 * Omissions require review; successful decoding grants no authority to act on email. */
export function decodeMailBody(input:MailSnapshot):MailBody {
  const snapshot=mailSnapshot(input.provider,input.content,input.id);
  const omissions=new Set<MailBody['omissions'][number]>();
  let nodes=0,bytes=0;
  type Block=MailBody['blocks'][number];
  const walk=(value:unknown,depth:number):Block[]=>{
    if(++nodes>100||depth>12){omissions.add('limit');return [];}
    const part=record(value);
    if(!part||typeof part.mimeType!=='string'){omissions.add('invalid_part');return [];}
    if(part.headers!==undefined&&(!Array.isArray(part.headers)||part.headers.some(h=>!record(h)||typeof h.name!=='string'||typeof h.value!=='string'))){omissions.add('invalid_part');return [];}
    const headers=(part.headers??[]) as {name:string;value:string}[];
    if((typeof part.filename==='string'&&part.filename.length>0)||headers.some(h=>h.name.toLowerCase()==='content-disposition'&&/^\s*attachment(?:\s*;|\s*$)/i.test(h.value))){omissions.add('attachment');return [];}
    const mime=part.mimeType.toLowerCase();
    if(mime.startsWith('multipart/')){
      if(!['multipart/mixed','multipart/alternative','multipart/related'].includes(mime)){omissions.add('unsupported_mime');return [];}
      if(!Array.isArray(part.parts)){omissions.add('invalid_part');return [];}
      const groups:Block[][]=[];
      for(const child of part.parts){if(nodes>=100){omissions.add('limit');break;}groups.push(walk(child,depth+1));}
      // Alternative representations describe the same body; prefer a valid plain version.
      if(mime==='multipart/alternative')return groups.find(g=>g.length&&g.every(b=>b.format==='text'))??groups.find(g=>g.length)??[];
      return groups.flat();
    }
    if(mime!=='text/plain'&&mime!=='text/html'){omissions.add('unsupported_mime');return [];}
    const body=record(part.body);
    if(!body){omissions.add('invalid_part');return [];}
    if(body.attachmentId!==undefined){omissions.add('external_body');return [];}
    if(typeof body.data!=='string'||!Number.isSafeInteger(body.size)||Number(body.size)<0){omissions.add('invalid_part');return [];}
    try {
      if(!/^[A-Za-z0-9_-]*={0,2}$/.test(body.data))throw new Error();
      const raw=body.data.replace(/=+$/,'');
      if(raw.length%4===1)throw new Error();
      const binary=atob(raw.replace(/-/g,'+').replace(/_/g,'/'));
      // Reject noncanonical encodings and inconsistent provider byte counts.
      if(btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==raw||binary.length!==body.size)throw new Error();
      bytes+=binary.length;
      if(bytes>96000){omissions.add('limit');return [];}
      const contentTypes=headers.filter(h=>h.name.toLowerCase()==='content-type');
      if(contentTypes.length>1)throw new Error();
      const charset=contentTypes[0]?.value.match(/charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
      const encoding=charset?.[1]??charset?.[2]??'utf-8';
      const content=new TextDecoder(encoding,{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
      return [{format:mime==='text/plain'?'text':'html',content}];
    }catch{omissions.add('invalid_encoding');return [];}
  };
  let blocks:Block[];
  if(snapshot.provider==='microsoft'){
    const body=snapshot.content.body as {contentType:'text'|'html';content:string};
    if(new TextEncoder().encode(body.content).length>96000){omissions.add('limit');blocks=[];}
    else blocks=[{format:body.contentType,content:body.content}];
  }else blocks=walk(snapshot.content.payload,0);
  return {blocks,omissions:[...omissions],trustedForInstructions:false};
}
