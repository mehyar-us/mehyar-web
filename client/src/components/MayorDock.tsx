import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLocation } from "wouter";
import { ArrowUp, Plus, History, X, Mic, Volume2, Square, Bookmark, Copy, Download, Trash2, Maximize2, Minimize2, ExternalLink, ArrowRight, MoreHorizontal } from "lucide-react";
import { useExplorer } from "./MayorStore";
import { VisualBoard } from "./VisualExplorer";
import PwaControls from "./PwaControls";
import { createMayorVoice, MayorSpeechPlatform, MayorVoiceState } from "@/lib/mayor-voice";
import { MayorTurn } from "@/lib/mayor-conversations";
import { createMayorRecorder } from "@/lib/mayor-recorder";

function spokenAnswer(turn:MayorTurn) {
  return `${turn.response.answer.replaceAll("**","")} ${turn.response.blocks.map(b=>b.type==='workflow'?`${b.title}. ${b.steps.map(s=>s.title).join('. ')}.`:b.title).join('. ')}`;
}
export default function MayorDock() {
  const mayor=useExplorer(), [path,navigate]=useLocation();
  const [showHistory,setShowHistory]=useState(false), [expanded,setExpanded]=useState(false), [deleteId,setDeleteId]=useState<string|null>(null),
    [voiceState,setVoiceState]=useState<MayorVoiceState>("idle"), [voiceError,setVoiceError]=useState(""), [heard,setHeard]=useState(""),
    [autoRead,setAutoRead]=useState(false), [supports,setSupports]=useState({input:false,output:false}), [copied,setCopied]=useState(false);
  const voice=useRef<ReturnType<typeof createMayorVoice>|null>(null), textarea=useRef<HTMLTextAreaElement>(null),
    end=useRef<HTMLDivElement>(null), transcript=useRef<HTMLDivElement>(null), lastTurn=useRef<HTMLElement>(null), launcher=useRef<HTMLButtonElement>(null), baseDraft=useRef(""), spokenId=useRef("");
  const recorder=useRef<ReturnType<typeof createMayorRecorder>|null>(null);
  const stopVoice=()=>{recorder.current?.cancel();voice.current?.stop();};
  const excluded=/^\/(admin|dashboard|private|q|billing|proposals|audit\/report|client-template|unsubscribe)(\/|$)/.test(path);
  useEffect(()=>{
    voice.current=createMayorVoice(window as unknown as MayorSpeechPlatform,{
      state:setVoiceState,error:setVoiceError,
      transcript:(text,final)=>{setHeard(text);if(final){mayor.setDraft(`${baseDraft.current}${baseDraft.current?' ':''}${text}`.slice(0,1600));setHeard("");}}
    });
    if(typeof navigator.mediaDevices?.getUserMedia==='function'&&typeof window.MediaRecorder==='function'&&typeof window.AudioContext==='function')recorder.current=createMayorRecorder({state:setVoiceState,error:setVoiceError,transcript:text=>{mayor.setDraft(`${baseDraft.current}${baseDraft.current?' ':''}${text}`.slice(0,1600));setHeard("");}});
    setSupports({input:!!recorder.current||voice.current.supportsInput,output:voice.current.supportsOutput});
    return()=>stopVoice();
  },[]);
  useEffect(()=>{if(!mayor.open||excluded){stopVoice();setHeard("");if(excluded&&mayor.open)mayor.setOpen(false);}},[mayor.open,excluded]);
  useEffect(()=>{
    if(!mayor.open)return;
    const viewport=window.visualViewport;
    const sync=()=>{document.documentElement.style.setProperty("--mayor-viewport-height",`${viewport?.height||window.innerHeight}px`);document.documentElement.style.setProperty("--mayor-viewport-top",`${viewport?.offsetTop||0}px`);};
    sync();viewport?.addEventListener("resize",sync);viewport?.addEventListener("scroll",sync);
    return()=>{viewport?.removeEventListener("resize",sync);viewport?.removeEventListener("scroll",sync);document.documentElement.style.removeProperty("--mayor-viewport-height");document.documentElement.style.removeProperty("--mayor-viewport-top");};
  },[mayor.open]);
  const last=mayor.conversation.turns.at(-1);
  const scrollConversation=()=>{
    const region=transcript.current;
    if(region&&mayor.busy)region.scrollTop=region.scrollHeight;
    else if(region&&lastTurn.current)region.scrollTop+=lastTurn.current.getBoundingClientRect().top-region.getBoundingClientRect().top-16;
  };
  useEffect(()=>{
    scrollConversation();
    if(last&&last.id!==spokenId.current){spokenId.current=last.id;if(autoRead&&mayor.open)voice.current?.speak(spokenAnswer(last),navigator.language);}
  },[last?.id,mayor.busy,mayor.open]);
  const send=(q=mayor.draft)=>{stopVoice();setVoiceError("");setHeard("");void mayor.ask(q);};
  const listen=()=>{stopVoice();setVoiceError("");baseDraft.current=mayor.draft;if(recorder.current)void recorder.current.start();else voice.current?.listen(navigator.language);};
  const close=()=>{stopVoice();if(mayor.busy)mayor.cancel();mayor.setOpen(false);};
  if(excluded)return null;
  return <>
    <Dialog.Root open={mayor.open} onOpenChange={v=>v?mayor.setOpen(true):close()}>
      <Dialog.Trigger asChild><button ref={launcher} className="mayor-launcher" aria-label="Ask The Mayor" data-busy={mayor.busy}>
        <span className="mayor-avatar"><img src="/assets/mayor-avatar.webp" alt="" width="64" height="64"/></span><span><strong>Ask The Mayor</strong><small>Your AI companion</small></span>
      </button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="mayor-overlay"/>
        <Dialog.Content className={`mayor-dialog ${expanded?'mayor-expanded':''}`} onOpenAutoFocus={e=>{e.preventDefault();textarea.current?.focus({preventScroll:true});scrollConversation();}} onCloseAutoFocus={e=>{e.preventDefault();launcher.current?.focus({preventScroll:true});}}>
          <header className="mayor-chat-header">
            <span className="mayor-avatar" data-state={voiceState==='idle'&&mayor.busy?'thinking':voiceState}><img src="/assets/mayor-avatar.webp" alt="" width="48" height="48"/></span>
            <div><Dialog.Title>The Mayor</Dialog.Title><Dialog.Description>By MehyarSoft · public AI companion</Dialog.Description></div>
            <div className="mayor-header-actions">
              <button aria-label={showHistory?"Hide conversation history":"Conversation history"} aria-pressed={showHistory} onClick={()=>setShowHistory(!showHistory)}><History size={19}/></button>
              <button aria-label={expanded?"Compact chat":"Expand chat"} className="mayor-expand" onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button>
              <button aria-label="Minimize The Mayor" onClick={close}><X size={21}/></button>
            </div>
          </header>
          <div className="mayor-chat-body" data-history={showHistory}>
            {showHistory&&<aside className="mayor-history" aria-label="Saved conversations">
              <button className="mayor-new-chat" onClick={()=>{stopVoice();mayor.newChat();setShowHistory(false);textarea.current?.focus();}}><Plus size={18}/> New conversation</button>
              <h3>Saved on this device</h3><p>Up to 10 chats. No account or cloud sync. Save only what you want to keep.</p>
              {mayor.history.length===0?<p>No saved conversations yet.</p>:mayor.history.map(c=><div className="mayor-history-item" key={c.id}>
                <button aria-current={c.id===mayor.conversation.id?"true":undefined} onClick={()=>{stopVoice();mayor.load(c.id);setShowHistory(false);}}><strong>{c.title}</strong><small>{c.turns.length} replies · {new Date(c.updatedAt).toLocaleDateString()}</small></button>
                {deleteId===c.id?<div className="mayor-delete-confirm"><span>Delete this saved chat?</span><button onClick={()=>{mayor.remove(c.id);setDeleteId(null);}}>Delete</button><button onClick={()=>setDeleteId(null)}>Keep</button></div>:<button aria-label={`Delete saved chat: ${c.title}`} onClick={()=>setDeleteId(c.id)}><Trash2 size={16}/></button>}
              </div>)}
              <button className="mayor-history-back" onClick={()=>setShowHistory(false)}>Back to conversation <ArrowRight size={16}/></button>
              <a href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">Customer workspace <ExternalLink size={14}/></a><small>A separate sign-in and private account.</small>
            </aside>}
            <div className="mayor-chat-main">
              <div ref={transcript} className="mayor-transcript" tabIndex={0} role="log" aria-label="Conversation with The Mayor" aria-live="polite" aria-relevant="additions">
                {mayor.conversation.turns.length===0&&!mayor.busy&&<div className="mayor-welcome">
                  <img src="/assets/mayor-avatar.webp" alt="The Mayor, illustrated AI companion" width="88" height="88"/>
                  <p className="site-eyebrow">A conversation. A clearer picture.</p><h2>What are you working on?</h2>
                  <p>Ask about a business, a software idea, or how something works. I can help you explore it visually.</p>
                  <div className="mayor-quick-prompts">{['Show me how missed calls become bookings','Compare custom AI with our existing tools','Plan an AI pilot for an enterprise team'].map(q=><button key={q} onClick={()=>{mayor.setDraft(q);textarea.current?.focus();}}>{q}<ArrowRight size={15}/></button>)}</div>
                </div>}
                {mayor.conversation.turns.map(turn=><section ref={turn.id===last?.id?lastTurn:undefined} className="mayor-turn" key={turn.id}>
                  <div className="mayor-user-message"><span className="sr-only">You: </span>{turn.question}</div>
                  <article className="mayor-answer">
                    <div className="mayor-author"><img src="/assets/mayor-avatar.webp" alt="" width="28" height="28"/><strong>The Mayor</strong></div>
                    <h2>{turn.response.title}</h2><p className="mayor-answer-text">{turn.response.answer.split(/(\*\*[^*]+\*\*)/).map((part,i)=>part.startsWith('**')&&part.endsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</p>
                    <VisualBoard answer={turn.response} onAsk={question=>send(turn.response.answerOrigin==='verified-product-guide'?`In the signed-in Mayor Business agent, ${question}`:question)} onNavigate={close}/>
                    <p className="mayor-answer-caption">{turn.response.answerOrigin==='verified-product-guide'?'Product guide · existing workspace features. Sign-in required.':'AI explanation · illustrative possibilities. Verify scope and integrations.'}</p>
                    {turn.response.sources.length>0&&<p className="mayor-source-links">Public references: {turn.response.sources.map(s=><a key={s} href={s} onClick={()=>{close();}}>{s.replace(/^\//,'').replaceAll('/',' / ')}</a>)}</p>}
                    <button className="mayor-read-aloud" disabled={!supports.output||voiceState==='starting'||voiceState==='listening'||voiceState==='transcribing'} onClick={()=>{stopVoice();setVoiceError("");voice.current?.speak(spokenAnswer(turn),navigator.language);}}><Volume2 size={16}/> Read aloud</button>
                  </article>
                </section>)}
                {mayor.busy&&<section className="mayor-turn"><div className="mayor-user-message">{mayor.pending}</div><div className="mayor-thinking"><img src="/assets/mayor-avatar.webp" alt="" width="32" height="32"/><span>Thinking through your question<span className="mayor-thinking-dots" aria-hidden="true">…</span></span></div></section>}
              {last&&!mayor.busy&&<div className="mayor-followups" aria-label="Continue this conversation">{last.response.followUps.map(q=><button key={q} onClick={()=>send(q)}>{q}</button>)}</div>}
                <div ref={end}/>
              </div>
              {mayor.error&&<div className="mayor-error" role="alert"><p>{mayor.error}</p><button disabled={mayor.busy||!mayor.online} onClick={()=>send()}>Retry question</button></div>}
              <div className="mayor-status" role="status" aria-live="polite">{voiceError|| (voiceState==='listening'?`Listening… ${heard||'Tap the mic to finish.'}`:voiceState==='starting'?'Allow microphone access in your browser. Tap the mic to cancel.':voiceState==='transcribing'?'Transcribing your voice message. Review the text before sending…':voiceState==='speaking'?'The Mayor is speaking.':mayor.busy?'Preparing your text and visual answer…':mayor.notice)}</div>
              <form className="mayor-composer" onSubmit={e=>{e.preventDefault();send();}}>
                <label className="sr-only" htmlFor="mayor-message">Message The Mayor</label>
                <textarea ref={textarea} id="mayor-message" value={mayor.draft} onChange={e=>mayor.setDraft(e.target.value)} maxLength={1600} rows={2} disabled={mayor.busy||voiceState==='listening'||voiceState==='starting'||voiceState==='transcribing'} placeholder="Ask The Mayor anything about your idea…" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/>
                <div className="mayor-composer-actions">
                  <div><button type="button" aria-label="New conversation" disabled={mayor.busy} onClick={()=>{stopVoice();mayor.newChat();textarea.current?.focus();}}><Plus size={20}/></button>
                    <button type="button" aria-label={voiceState==='listening'?"Stop listening":voiceState==='starting'?"Cancel microphone request":voiceState==='transcribing'?"Cancel transcription":"Start voice input"} disabled={!supports.input||mayor.busy||!mayor.online} aria-pressed={voiceState==='listening'||voiceState==='starting'} onClick={()=>voiceState==='listening'?(recorder.current?recorder.current.finish():voice.current?.finishListening()):voiceState==='starting'||voiceState==='transcribing'?stopVoice():listen()}><Mic size={20}/></button>
                    {voiceState==='speaking'&&<button type="button" aria-label="Stop speaking" onClick={()=>voice.current?.stop()}><Square size={18}/></button>}
                  </div>
                  <span>{!mayor.online?'Offline · draft only':mayor.history.some(c=>c.id===mayor.conversation.id)?'Saved on this device':'This visit · save by choice'}</span>
                  {mayor.busy?<button key="cancel" type="button" aria-label="Cancel answer" onClick={mayor.cancel}><Square size={18}/></button>:<button key="send" type="submit" aria-label="Send to The Mayor" className="mayor-send" disabled={!mayor.draft.trim()||!mayor.online||voiceState==='listening'||voiceState==='starting'||voiceState==='transcribing'}><ArrowUp size={21}/></button>}
                </div>
              </form>
              <p className="mayor-voice-note">30s voice via Cloudflare. Review text before sending.</p>
              <div className="mayor-chat-tools">
                <label><input type="checkbox" checked={autoRead} disabled={!supports.output||voiceState==='starting'||voiceState==='listening'||voiceState==='transcribing'} onChange={e=>{setAutoRead(e.target.checked);if(!e.target.checked)stopVoice();}}/> Read replies aloud</label>
                <button disabled={!mayor.conversation.turns.length||mayor.busy} onClick={mayor.save}><Bookmark size={15}/> Save chat</button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild><button aria-label="More chat actions"><MoreHorizontal size={19}/><span>More</span></button></DropdownMenu.Trigger>
                  <DropdownMenu.Portal><DropdownMenu.Content className="mayor-actions-menu" side="top" align="end" sideOffset={8} collisionPadding={12}>
                    <DropdownMenu.Item disabled={!mayor.conversation.turns.length} onSelect={()=>{void navigator.clipboard.writeText(mayor.summary).then(()=>setCopied(true)).catch(()=>setVoiceError("Copy is unavailable. Download the chat instead."));}}><Copy size={16}/>{copied?'Copied':'Copy conversation'}</DropdownMenu.Item>
                    <DropdownMenu.Item disabled={!mayor.conversation.turns.length} asChild><a download="conversation-with-the-mayor.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(mayor.summary)}`}><Download size={16}/> Download conversation</a></DropdownMenu.Item>
                    <DropdownMenu.Item disabled={!mayor.conversation.turns.length} onSelect={()=>{mayor.prepareBrief();close();navigate(`/contact?service=automation-sprint&source=visual_explorer&${new URLSearchParams(mayor.attribution).toString()}`);}}>Review project brief <ArrowRight size={16}/></DropdownMenu.Item>
                    <DropdownMenu.Separator className="mayor-menu-separator"/>
                    <DropdownMenu.Item asChild><a href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Private Mayor sign-in</a></DropdownMenu.Item>
                    <p className="mayor-menu-caption">Manage your business AI and configured automations in your separate workspace.</p>
                  </DropdownMenu.Content></DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
              <details className="mayor-boundaries"><summary>Privacy, voice & limits</summary><p>Questions go to our AI provider. Keep private records and credentials out. No current web research or business tools are connected. Recorded voice clips go to Cloudflare for transcription when you stop recording, or after 29 seconds. Cancel or close to discard a recording. Audio is not saved by this site. Where recording is unavailable, dictation uses your browser’s speech service. Read aloud uses your browser’s speech service and may be processed by its provider. Review dictated text before sending. Text always works if voice is unavailable. Chats stay in memory unless you save them on this device; saved chats do not sync to your private Mayor account. Up to 6 questions or voice transcriptions per IP per minute, with a shared daily allowance.</p></details>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <div className="mayor-install-launcher"><PwaControls compact/></div>
  </>;
}
