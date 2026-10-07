import {afterEach,describe,expect,it,vi} from 'vitest';
import {bindChatKeyboardViewport,chatKeyboardViewport,chatComposerHeightLimit,type ChatViewportInput} from '../web/chat-keyboard-viewport';

const phone:ChatViewportInput={chat:true,composerFocused:true,layoutHeight:844,visibleHeight:500,offsetTop:0,scale:1};
describe('chat keyboard visible bounds',()=>{
 it('places the phone shell and navigation above an overlay keyboard',()=>{
  expect(chatKeyboardViewport(phone)).toEqual({height:500,top:0,bottom:344});
 });
 it('follows viewport panning without counting its top offset as keyboard space',()=>{
  expect(chatKeyboardViewport({...phone,offsetTop:134})).toEqual({height:500,top:134,bottom:210});
 });
 it('supports landscape phones and tablet layouts independently of width',()=>{
  expect(chatKeyboardViewport({...phone,layoutHeight:430,visibleHeight:250,offsetTop:20})).toEqual({height:250,top:20,bottom:160});
  expect(chatKeyboardViewport({...phone,layoutHeight:1024,visibleHeight:600})).toEqual({height:600,top:0,bottom:424});
 });
 it('restores normal layout after dismissal, blur or leaving the conversation',()=>{
  for(const input of [{...phone,visibleHeight:844},{...phone,composerFocused:false},{...phone,chat:false}])expect(chatKeyboardViewport(input)).toBeNull();
 });
 it('does not mistake browser chrome or a resized layout viewport for a keyboard',()=>{
  for(const height of [844,800,745])expect(chatKeyboardViewport({...phone,visibleHeight:height})).toBeNull();
  expect(chatKeyboardViewport({...phone,layoutHeight:500})).toBeNull();
 });
 it('compacts focused typing in a short window even when both viewport heights match',()=>{
  for(const height of [250,400,401,480])expect(chatKeyboardViewport({...phone,layoutHeight:height,visibleHeight:height})).toEqual({height,top:0,bottom:0});
  expect(chatKeyboardViewport({...phone,layoutHeight:481,visibleHeight:481})).toBeNull();
  for(const extra of [{composerFocused:false},{chat:false},{scale:1.5}])expect(chatKeyboardViewport({...phone,layoutHeight:250,visibleHeight:250,...extra})).toBeNull();
 });
 it('preserves user zoom instead of repositioning the page during magnification',()=>{
  for(const scale of [0.8,1.1,1.5,2])expect(chatKeyboardViewport({...phone,scale})).toBeNull();
 });
 it('rejects unavailable, invalid or inconsistent viewport geometry',()=>{
  for(const input of [{...phone,visibleHeight:0},{...phone,layoutHeight:0},{...phone,visibleHeight:NaN},{...phone,offsetTop:-1},{...phone,offsetTop:400},{...phone,scale:Infinity}])expect(chatKeyboardViewport(input)).toBeNull();
 });
});

function browserFixture(withViewport=true){
 const viewport=Object.assign(new EventTarget(),{height:500,offsetTop:0,scale:1});
 const composer=Object.assign(new EventTarget(),{disabled:false,hidden:false,getClientRects:()=>[{}]});
 const properties=new Map<string,string>(),body={dataset:{view:'chat'} as Record<string,string>,style:{setProperty:(name:string,value:string)=>properties.set(name,value),removeProperty:(name:string)=>properties.delete(name)}};
 const document={body,activeElement:composer};
 const window=Object.assign(new EventTarget(),{innerHeight:844,visualViewport:withViewport?viewport:null});
 const frames=new Map<number,()=>void>();let nextFrame=0;
 vi.stubGlobal('window',window);vi.stubGlobal('document',document);
 vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{frames.set(++nextFrame,callback);return nextFrame;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());};
 return {viewport,composer:composer as unknown as HTMLTextAreaElement,document,window,body,properties,frames,flush};
}
afterEach(()=>vi.unstubAllGlobals());

describe('keyboard adapter browser lifecycle',()=>{
 it('coalesces browser resize and pan events, then updates both visible bounds and draft sizing',()=>{
  const browser=browserFixture(),changed=vi.fn(),binding=bindChatKeyboardViewport(browser.composer,changed);
  browser.viewport.dispatchEvent(new Event('resize'));browser.viewport.dispatchEvent(new Event('scroll'));
  expect(browser.frames.size).toBe(1);browser.flush();
  expect(browser.body.dataset.chatKeyboard).toBe('open');expect(browser.properties.get('--chat-viewport-height')).toBe('500px');expect(changed).toHaveBeenCalledTimes(1);
  browser.viewport.height=250;browser.viewport.offsetTop=20;browser.window.dispatchEvent(new Event('orientationchange'));browser.flush();
  expect(browser.properties.get('--chat-viewport-height')).toBe('250px');expect(browser.properties.get('--chat-viewport-top')).toBe('20px');expect(changed).toHaveBeenCalledTimes(2);binding.dispose();
 });
 it('clears geometry after blur, navigation or disabling a previously focused composer',()=>{
  for(const cause of ['blur','navigation','disabled']){
   const browser=browserFixture(),binding=bindChatKeyboardViewport(browser.composer);browser.flush();
   if(cause==='blur')browser.document.activeElement=null as unknown as typeof browser.document.activeElement;
   if(cause==='navigation')browser.body.dataset.view='account';
   if(cause==='disabled')browser.composer.disabled=true;
   browser.composer.dispatchEvent(new Event('blur'));binding.sync();browser.flush();
   expect(browser.body.dataset.chatKeyboard).toBeUndefined();expect(browser.properties.size).toBe(0);binding.dispose();
  }
 });
 it('cancels pending updates and removes event listeners when workspace access ends',()=>{
  const browser=browserFixture(),binding=bindChatKeyboardViewport(browser.composer);browser.flush();
  browser.viewport.dispatchEvent(new Event('resize'));binding.dispose();
  expect(browser.frames.size).toBe(0);expect(browser.properties.size).toBe(0);expect(browser.body.dataset.chatKeyboard).toBeUndefined();
  browser.viewport.dispatchEvent(new Event('resize'));browser.composer.dispatchEvent(new Event('focus'));browser.window.dispatchEvent(new Event('resize'));expect(browser.frames.size).toBe(0);
 });
 it('keeps the existing layout usable when VisualViewport is unavailable',()=>{
  const browser=browserFixture(false),binding=bindChatKeyboardViewport(browser.composer);binding.sync();binding.dispose();
  expect(browser.frames.size).toBe(0);expect(browser.properties.size).toBe(0);
 });
});

describe('composer space while typing',()=>{
 it('keeps normal phone and desktop draft limits when the keyboard is closed',()=>{
  expect(chatComposerHeightLimit(true)).toBe(120);expect(chatComposerHeightLimit(false)).toBe(170);
 });
 it('bounds a long draft to a quarter of the visible area after rotation or keyboard opening',()=>{
  for(const phone of [true,false])expect(chatComposerHeightLimit(phone,250)).toBe(62);
  expect(chatComposerHeightLimit(true,500)).toBe(120);expect(chatComposerHeightLimit(false,500)).toBe(125);
  expect(chatComposerHeightLimit(false,1024)).toBe(170);
 });
 it('keeps a short-window draft bounded after blur and restores its normal limit when the window grows',()=>{
  for(const phone of [true,false]){
   expect(chatComposerHeightLimit(phone,undefined,250)).toBe(62);
   expect(chatComposerHeightLimit(phone,undefined,400)).toBe(100);
   expect(chatComposerHeightLimit(phone,undefined,401)).toBe(100);
   expect(chatComposerHeightLimit(phone,undefined,480)).toBe(120);
   expect(chatComposerHeightLimit(phone,undefined,481)).toBe(120);
   expect(chatComposerHeightLimit(phone,undefined,844)).toBe(phone?120:170);
   for(const height of [0,-1,NaN,Infinity])expect(chatComposerHeightLimit(phone,undefined,height)).toBe(phone?120:170);
  }
 });
 it('preserves a readable one-line input and ignores unavailable geometry',()=>{
  expect(chatComposerHeightLimit(true,100)).toBe(36);
  for(const height of [0,-1,NaN,Infinity])expect(chatComposerHeightLimit(true,height)).toBe(120);
 });
});
