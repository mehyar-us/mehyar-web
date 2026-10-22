/**
 * Image Studio — promo image generation UI (workstream 7d).
 *
 * Exposes mountImageStudio(); web/main.ts owns the mounting (not this file).
 * Flow: use-case picker → prompt preview (editable) → generate → gallery →
 * attach to post draft via the onAttach hook (or the 'imagegen:attach' event).
 */

export interface ImageAsset{
 id:string;useCase:string;prompt:string;model:string;aiGenerated:boolean;
 status:string;usedIn:string[];createdAt:string;
}

export interface ImageStudioOptions{
 /** Defaults to window.fetch. */
 fetchImpl?:typeof fetch;
 /** Called when the owner attaches a generated image to a post draft. */
 onAttach?:(asset:ImageAsset,postId:string)=>void;
 /** Business name prefill. */
 businessName?:string;
 /** Vertical key prefill (salon, restaurant, plumbing_hvac, dental, auto_repair, other). */
 vertical?:string;
}

const USE_CASES:{value:string;label:string;hint:string}[]=[
 {value:'service_promo',label:'Service promo',hint:'Promote one service or offer'},
 {value:'seasonal_offer',label:'Seasonal offer',hint:'Holiday / seasonal creative'},
 {value:'social_creative',label:'Social creative',hint:'Bold square post for social'},
 {value:'before_after_frame',label:'Before / after frame',hint:'Branded frame — you add your own real photos'},
];

function el<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
}

function labeledInput(labelText:string,input:HTMLElement){
 const wrap=el('label','imagegen-field');
 wrap.append(el('span','imagegen-label',labelText),input);
 return wrap;
}

export function mountImageStudio(container:HTMLElement,tenantId:string,options:ImageStudioOptions={}){
 const fetchImpl=options.fetchImpl??window.fetch.bind(window);
 const base=`/api/businesses/${tenantId}/imagegen`;
 const state:{assets:ImageAsset[];busy:boolean;imageBase64:string|null;lastAssetId:string|null}=
  {assets:[],busy:false,imageBase64:null,lastAssetId:null};

 const root=el('section','imagegen-studio');
 root.setAttribute('aria-label','Image studio');

 const heading=el('h2',undefined,'Image studio');
 const sub=el('p','imagegen-sub','AI-generated promo images for your business. Every image is watermarked as AI-generated in our records.');
 root.append(heading,sub);

 // ---- form ----
 const form=el('div','imagegen-form');

 const useCaseSelect=el('select','imagegen-input') as HTMLSelectElement;
 for(const uc of USE_CASES){
  const opt=document.createElement('option');opt.value=uc.value;
  opt.textContent=`${uc.label} — ${uc.hint}`;useCaseSelect.append(opt);
 }

 const nameInput=el('input','imagegen-input') as HTMLInputElement;
 nameInput.placeholder='Business name (spelled exactly as it should appear)';
 nameInput.value=options.businessName??'';
 nameInput.setAttribute('aria-label','Business name');

 const headlineInput=el('input','imagegen-input') as HTMLInputElement;
 headlineInput.placeholder='Headline (optional, max 8 words — no fake claims or invented prices)';
 headlineInput.setAttribute('aria-label','Headline');

 const priceInput=el('input','imagegen-input') as HTMLInputElement;
 priceInput.placeholder='Price (optional — only from your real price list)';
 priceInput.setAttribute('aria-label','Price');

 const colorsInput=el('input','imagegen-input') as HTMLInputElement;
 colorsInput.placeholder='Brand colors (optional, e.g. #1a2b4c, #f5c518)';
 colorsInput.setAttribute('aria-label','Brand colors');

 const promptInput=el('textarea','imagegen-input imagegen-prompt') as HTMLTextAreaElement;
 promptInput.rows=4;
 promptInput.placeholder='Describe the image — e.g. "A bright promo for our spring facial event"';
 promptInput.setAttribute('aria-label','Image prompt (editable)');

 const generateBtn=el('button','imagegen-generate','Generate image') as HTMLButtonElement;
 generateBtn.type='button';

 const status=el('p','imagegen-status');
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');

 form.append(
  labeledInput('Use case',useCaseSelect),
  labeledInput('Business name',nameInput),
  labeledInput('Headline',headlineInput),
  labeledInput('Price',priceInput),
  labeledInput('Brand colors',colorsInput),
  labeledInput('Prompt preview (editable)',promptInput),
  generateBtn,status);
 root.append(form);

 // ---- preview ----
 const previewWrap=el('div','imagegen-preview');previewWrap.hidden=true;
 const previewImg=el('img','imagegen-preview-img') as HTMLImageElement;
 previewImg.alt='';
 const previewBadge=el('p','imagegen-badge','AI-generated');
 const attachBtn=el('button','secondary','Attach to post draft') as HTMLButtonElement;
 attachBtn.type='button';
 previewWrap.append(previewImg,previewBadge,attachBtn);
 root.append(previewWrap);

 // ---- gallery ----
 const galleryTitle=el('h3',undefined,'Your images');
 const gallery=el('div','imagegen-gallery');
 gallery.setAttribute('role','list');
 root.append(galleryTitle,gallery);

 async function api(path:string,init?:RequestInit){
  const response=await fetchImpl(base+path,{...init,headers:{'content-type':'application/json',...(init?.headers??{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error((body as {message?:string}).message??`Request failed (${response.status}).`);
  return body as any;
 }

 function setStatus(text:string){status.textContent=text;}

 async function refreshGallery(){
  try{
   const body=await api('/assets');
   state.assets=(body.assets??[]) as ImageAsset[];
  }catch(error){setStatus(error instanceof Error?error.message:'Could not load images.');return;}
  gallery.replaceChildren();
  if(!state.assets.length){
   gallery.append(el('p','imagegen-empty','No images yet. Generate your first one above.'));
   return;
  }
  for(const asset of state.assets){
   const card=el('div','imagegen-card');card.setAttribute('role','listitem');
   const meta=el('div','imagegen-card-meta');
   const label=USE_CASES.find(u=>u.value===asset.useCase)?.label??asset.useCase;
   meta.append(el('strong',undefined,label),el('span','imagegen-badge','AI-generated'));
   const desc=el('p','imagegen-card-prompt',asset.prompt);
   const when=el('time',undefined,new Date(asset.createdAt).toLocaleDateString());
   const actions=el('div','imagegen-card-actions');
   const attach=el('button','secondary','Attach to post draft') as HTMLButtonElement;
   attach.type='button';
   attach.onclick=()=>attachToDraft(asset);
   const del=el('button','secondary imagegen-danger','Delete') as HTMLButtonElement;
   del.type='button';
   del.onclick=async()=>{
    try{await api(`/assets/${asset.id}`,{method:'DELETE'});await refreshGallery();}
    catch(error){setStatus(error instanceof Error?error.message:'Delete failed.');}
   };
   actions.append(attach,del);
   card.append(meta,desc,when,actions);
   gallery.append(card);
  }
 }

 async function attachToDraft(asset:ImageAsset){
  const postId=window.prompt('Post draft id to attach this image to:');
  if(!postId)return;
  try{
   await api(`/assets/${asset.id}/attach`,{method:'POST',body:JSON.stringify({postId})});
   options.onAttach?.(asset,postId);
   container.dispatchEvent(new CustomEvent('imagegen:attach',{bubbles:true,detail:{asset,postId}}));
   setStatus('Image attached to the post draft.');
   await refreshGallery();
  }catch(error){setStatus(error instanceof Error?error.message:'Attach failed.');}
 }

 generateBtn.onclick=async()=>{
  if(state.busy)return;
  const businessName=nameInput.value.trim();
  if(!businessName){setStatus('Add your business name first — it is spelled into the image.');nameInput.focus();return;}
  const headline=headlineInput.value.trim();
  if(headline&&headline.split(/\s+/).length>8){setStatus('Keep the headline to 8 words or fewer — short text renders cleanly.');headlineInput.focus();return;}
  const colors=colorsInput.value.split(',').map(c=>c.trim()).filter(c=>/^#[0-9a-fA-F]{6}$/.test(c));
  state.busy=true;generateBtn.disabled=true;setStatus('Generating… this can take up to a minute.');
  try{
   const body=await api('/generate',{method:'POST',body:JSON.stringify({
    useCase:useCaseSelect.value,
    prompt:promptInput.value.trim()||`A ${USE_CASES.find(u=>u.value===useCaseSelect.value)?.label.toLowerCase()} for ${businessName}`,
    brand:{
     businessName,
     vertical:options.vertical,
     ...(colors.length?{brandColors:colors}:{}),
     ...(headline?{headline}:{}),
     ...(priceInput.value.trim()?{price:priceInput.value.trim()}:{}),
    },
   })});
   state.imageBase64=body.image.base64;
   state.lastAssetId=body.asset.id;
   previewImg.src=`data:${body.image.mimeType};base64,${body.image.base64}`;
   previewImg.alt=`AI-generated ${useCaseSelect.value.replace(/_/g,' ')} image for ${businessName}`;
   previewWrap.hidden=false;
   setStatus('Done — review it before using. It is recorded as AI-generated.');
   await refreshGallery();
  }catch(error){setStatus(error instanceof Error?error.message:'Generation failed.');}
  finally{state.busy=false;generateBtn.disabled=false;}
 };

 attachBtn.onclick=()=>{
  if(!state.lastAssetId)return;
  const asset=state.assets.find(a=>a.id===state.lastAssetId);
  if(asset)attachToDraft(asset);
 };

 container.append(root);
 void refreshGallery();
 return {
  element:root,
  refresh:refreshGallery,
  destroy(){root.remove();},
 };
}
