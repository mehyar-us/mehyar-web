export type ChatViewportInput={
 chat:boolean;composerFocused:boolean;layoutHeight:number;
 visibleHeight:number;offsetTop:number;scale:number;
};
export type ChatKeyboardViewport={height:number;top:number;bottom:number};

export function chatComposerHeightLimit(phone:boolean,keyboardHeight?:number,layoutHeight?:number){
 const normal=phone?120:170;
 const height=keyboardHeight??layoutHeight;
 return height!==undefined&&Number.isFinite(height)&&height>0
  ?Math.min(normal,Math.max(36,Math.floor(height/4))):normal;
}

// Adapt focused typing after a substantial viewport shrink or in an already
// short window. Browser chrome and magnification keep their normal positioning.
export function chatKeyboardViewport(input:ChatViewportInput):ChatKeyboardViewport|null{
 const {chat,composerFocused,layoutHeight,visibleHeight,offsetTop,scale}=input;
 if(!chat||!composerFocused||![layoutHeight,visibleHeight,offsetTop,scale].every(Number.isFinite)
  ||layoutHeight<=0||visibleHeight<=0||offsetTop<0||Math.abs(scale-1)>.02
  ||offsetTop+visibleHeight>layoutHeight+2||(layoutHeight-visibleHeight<100&&visibleHeight>480))return null;
 return {height:visibleHeight,top:offsetTop,bottom:Math.max(0,layoutHeight-offsetTop-visibleHeight)};
}

export function bindChatKeyboardViewport(composer:HTMLTextAreaElement,onChange:()=>void=()=>{}){
 const viewport=window.visualViewport;
 if(!viewport)return {sync:()=>{},dispose:()=>{}};
 let frame=0,last='';
 const clear=()=>{
  const changed=last!=='';last='';
  delete document.body.dataset.chatKeyboard;
  for(const name of ['--chat-viewport-height','--chat-viewport-top','--chat-viewport-bottom'])document.body.style.removeProperty(name);
  if(changed)onChange();
 };
 const update=()=>{
  frame=0;
  const state=chatKeyboardViewport({chat:document.body.dataset.view==='chat',composerFocused:document.activeElement===composer&&!composer.disabled&&!composer.hidden&&composer.getClientRects().length>0,
   layoutHeight:window.innerHeight,visibleHeight:viewport.height,offsetTop:viewport.offsetTop,scale:viewport.scale});
  if(!state){clear();return;}
  const key=`${state.height}/${state.top}/${state.bottom}`;
  if(key===last)return;
  last=key;
  document.body.style.setProperty('--chat-viewport-height',`${state.height}px`);
  document.body.style.setProperty('--chat-viewport-top',`${state.top}px`);
  document.body.style.setProperty('--chat-viewport-bottom',`${state.bottom}px`);
  document.body.dataset.chatKeyboard='open';
  onChange();
 };
 const sync=()=>{if(!frame)frame=requestAnimationFrame(update);};
 for(const event of ['resize','scroll'])viewport.addEventListener(event,sync,{passive:true});
 for(const event of ['resize','orientationchange'])window.addEventListener(event,sync,{passive:true});
 composer.addEventListener('focus',sync);composer.addEventListener('blur',sync);
 sync();
 return {sync,dispose:()=>{
  if(frame)cancelAnimationFrame(frame);
  for(const event of ['resize','scroll'])viewport.removeEventListener(event,sync);
  for(const event of ['resize','orientationchange'])window.removeEventListener(event,sync);
  composer.removeEventListener('focus',sync);composer.removeEventListener('blur',sync);clear();
 }};
}
