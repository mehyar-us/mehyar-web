import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { z } from "zod";
import { visualAnswerSchema, preservedVisitSchema } from "@/lib/visual-answer";
import { contextForMayor, freshConversation, MAYOR_HISTORY_KEY, MAYOR_VISIT_KEY, mayorHistorySchema, mayorVisitSchema, MayorConversation, mayorSummary } from "@/lib/mayor-conversations";

export type VisualAnswer = z.infer<typeof visualAnswerSchema>;
type MayorContextValue = {
  open: boolean; setOpen: (v:boolean)=>void; launch: (question?:string, context?:string)=>void;
  conversation: MayorConversation; history: MayorConversation[];
  draft: string; setDraft: (v:string)=>void; busy: boolean; pending: string;
  error: string; notice: string; online: boolean;
  ask: (q:string)=>Promise<void>; cancel: ()=>void; newChat: ()=>void;
  save: ()=>void; load: (id:string)=>void; remove: (id:string)=>void;
  brief: string; setBrief: (v:string)=>void; prepareBrief: ()=>void;
  attribution: Record<string,string>; summary: string;
};
const Context = createContext<MayorContextValue|null>(null);
export function ExplorerProvider({children}:{children:ReactNode}) {
  const [open,setOpen] = useState(false), [conversation,setConversation] = useState<MayorConversation>(freshConversation),
    [history,setHistory] = useState<MayorConversation[]>([]), [draft,setDraft] = useState(""), [brief,setBrief] = useState(""),
    [busy,setBusy] = useState(false), [pending,setPending] = useState(""), [error,setError] = useState(""),
    [notice,setNotice] = useState(""), [online,setOnline] = useState(true);
  const controller = useRef<AbortController|null>(null), generation = useRef(0), ready = useRef(false);
  const attribution = useRef<Record<string,string>>(typeof window === "undefined" ? {} : Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k])=>["utm_source","utm_campaign","industry","source"].includes(k)).map(([k,v])=>[k,v.slice(0,160)])));
  useEffect(()=>{
    try {
      const parsed = mayorHistorySchema.safeParse(JSON.parse(localStorage.getItem(MAYOR_HISTORY_KEY)||"[]"));
      if(parsed.success) setHistory(parsed.data);
      const raw = sessionStorage.getItem(MAYOR_VISIT_KEY); sessionStorage.removeItem(MAYOR_VISIT_KEY);
      if(raw){const visit=mayorVisitSchema.safeParse(JSON.parse(raw)); if(visit.success){setConversation(visit.data.conversation);setDraft(visit.data.draft);setBrief(visit.data.brief);setOpen(visit.data.open);}}
      if(!raw){
        const legacy=sessionStorage.getItem("mehyar-approved-update"),legacyDraft=sessionStorage.getItem("mehyar-approved-draft");
        sessionStorage.removeItem("mehyar-approved-update");sessionStorage.removeItem("mehyar-approved-draft");
        if(legacy){const restored=preservedVisitSchema.safeParse(JSON.parse(legacy));if(restored.success){const c=freshConversation();if(restored.data.board)c.turns=[{id:`restored-${c.id}`,question:restored.data.board.question,response:restored.data.board.response}];c.title=restored.data.board?.question.slice(0,80)||c.title;setConversation(c);setBrief(restored.data.brief);attribution.current=restored.data.attribution;setNotice("Your earlier visit's latest visual was restored. Save this conversation on your device to keep it.");}}
        if(legacyDraft)setDraft(legacyDraft.slice(0,1600));
      }
    } catch { setNotice("Saved conversations are unavailable in this browser. You can still chat without saving."); }
    ready.current=true;
    const sync=()=>setOnline(navigator.onLine); sync();
    window.addEventListener("online",sync);window.addEventListener("offline",sync);
    return ()=>{window.removeEventListener("online",sync);window.removeEventListener("offline",sync);generation.current++;controller.current?.abort();};
  },[]);
  const persist = (next:MayorConversation[]) => {
    try {localStorage.setItem(MAYOR_HISTORY_KEY,JSON.stringify(next)); setHistory(next); return true;}
    catch {setNotice("This browser could not save the conversation. Download a copy instead."); return false;}
  };
  useEffect(()=>{
    if(!ready.current || !history.some(c=>c.id===conversation.id)) return;
    const old=history.find(c=>c.id===conversation.id);
    if(old?.updatedAt!==conversation.updatedAt) persist(history.map(c=>c.id===conversation.id?conversation:c));
  },[conversation,history]);
  useEffect(()=>{
    const preserve=(event:Event)=>{try{sessionStorage.setItem(MAYOR_VISIT_KEY,JSON.stringify({conversation,draft,brief,open}));}catch{event.preventDefault();}};
    window.addEventListener("mehyar-preserve-draft",preserve);return()=>window.removeEventListener("mehyar-preserve-draft",preserve);
  },[conversation,draft,brief,open]);
  const cancel=()=>{generation.current++;controller.current?.abort();controller.current=null;setBusy(false);setPending("");setError("Answer cancelled. Your question stays in the composer.");};
  const ask=async(question:string)=>{
    const q=question.trim().slice(0,1600); if(!q||busy)return;
    if(conversation.turns.length>=50){setError("This chat has reached 50 replies. Save or download it, then start a new conversation.");return;}
    if(!online){setError("You are offline. Your draft stays here; live answers need a connection. Nothing sends automatically.");return;}
    setDraft(q);setPending(q);setBusy(true);setError("");setNotice("");
    const abort=new AbortController(),id=++generation.current;controller.current=abort;
    const timeout=setTimeout(()=>{if(id!==generation.current)return;generation.current++;abort.abort();setBusy(false);setPending("");controller.current=null;setError("The Mayor took too long to answer. Your question stays here; retry when ready.");},30000);
    try{
      const response=await fetch("/api/explore",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({page:window.location.pathname.replace(/\/$/,"")||"/",messages:contextForMayor(conversation.turns,q)}),signal:abort.signal});
      const data=await response.json().catch(()=>null);if(id!==generation.current||abort.signal.aborted)return;
      if(!response.ok)throw new Error(data?.message||"The Mayor is unavailable right now. Please retry.");
      const answer=visualAnswerSchema.safeParse(data);if(!answer.success)throw new Error("That answer could not be displayed safely. Please retry.");
      setConversation(c=>({...c,title:c.turns.length?c.title:q.slice(0,80),updatedAt:Date.now(),turns:[...c.turns,{id:`turn-${id}-${Date.now()}`,question:q,response:answer.data}]}));
      setDraft("");setNotice("The Mayor replied. No business action was taken.");
    }catch(e){if(id===generation.current)setError(e instanceof TypeError?"The connection could not reach The Mayor. Your draft stays here. Retry when connected.":e instanceof Error?e.message:"Please try again.");}
    finally{clearTimeout(timeout);if(id===generation.current){setBusy(false);setPending("");controller.current=null;}}
  };
  const launch=(question="",context="")=>{setOpen(true); if(question)setDraft(question.slice(0,1600)); else if(context&&!draft)setDraft(`Help me understand ${context}.`);};
  const newChat=()=>{if(busy)cancel();setConversation(freshConversation());setDraft("");setBrief("");setError("");setNotice("");};
  const save=()=>{if(!conversation.turns.length||busy)return; if(history.length>=10&&!history.some(c=>c.id===conversation.id)){setNotice("You have 10 saved chats. Delete one in History before saving another, or download this chat.");return;} if(persist([conversation,...history.filter(c=>c.id!==conversation.id)]))setNotice("Saved on this device. Future replies in this chat will also be saved here. You can delete it in History.");};
  const load=(id:string)=>{const c=history.find(c=>c.id===id);if(!c)return;if(busy)cancel();setConversation(c);setDraft("");setError("");setNotice("Opened a conversation saved on this device.");setOpen(true);};
  const remove=(id:string)=>{if(persist(history.filter(c=>c.id!==id)))setNotice("Saved conversation deleted from this device. An open copy stays in this visit until you start a new chat.");};
  const summary=mayorSummary(conversation.turns);
  const prepareBrief=()=>{const latest=conversation.turns.at(-1);if(latest)setBrief(`Approved exploration brief\n\nLatest question: ${latest.question}\n\nThe Mayor's proposed explanation: ${latest.response.answer}\n\nVisual topics: ${latest.response.blocks.map(b=>b.title).join(", ")}\n\nNo business action taken. Please review scope and integrations.`.slice(0,4000));};
  return <Context.Provider value={{open,setOpen,launch,conversation,history,draft,setDraft,busy,pending,error,notice,online,ask,cancel,newChat,save,load,remove,brief,setBrief,prepareBrief,attribution:attribution.current,summary}}>{children}</Context.Provider>;
}
export function useExplorer(){const ctx=useContext(Context);if(!ctx)throw new Error("Missing Mayor context");return ctx;}
