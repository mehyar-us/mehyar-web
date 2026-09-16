import {briefFields} from './business-brief';

export const suggestionFields=Object.keys(briefFields.shape).filter(key=>key!=='industryPack');
export type BriefSuggestion={field:string;value:string;sourceMessageId:string};
export const suggestionInstruction=`Return JSON only: {"reply":"your conversational reply","briefSuggestions":[{"field":"field name","value":"exact excerpt from the latest user message"}]}. Propose at most three business facts only when the owner states them explicitly. Values must be verbatim excerpts, not inferred facts or instructions. Allowed fields: ${suggestionFields.join(',')}. Use an empty suggestions list when none apply. Suggestions never save data or authorize actions.`;

export function parseBriefReply(raw:string,message:{id:string;content:string},allowSuggestions:boolean):{reply:string;suggestions:BriefSuggestion[]}{
  // Plain conversational output remains compatible; only the explicit envelope
  // can produce suggestions. A malformed envelope must not be shown as success.
  const trimmed=raw.trim();
  if(!allowSuggestions||!trimmed.startsWith('{'))return {reply:raw,suggestions:[]};
  const data=JSON.parse(trimmed);
  if(!data||typeof data.reply!=='string'||!data.reply.trim()||!Array.isArray(data.briefSuggestions)||data.briefSuggestions.length>3)throw new Error('Invalid brief response');
  const suggestions:BriefSuggestion[]=[];
  if(allowSuggestions)for(const item of data.briefSuggestions){
    if(!item||typeof item.field!=='string'||!suggestionFields.includes(item.field)||typeof item.value!=='string'||!item.value.trim()||item.value.length>2000||!message.content.includes(item.value)||suggestions.some(s=>s.field===item.field))continue;
    suggestions.push({field:item.field,value:item.value,sourceMessageId:message.id});
  }
  return {reply:data.reply,suggestions};
}
