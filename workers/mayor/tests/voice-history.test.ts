import {it,expect} from 'vitest';
import {voiceHistory} from '../src/voice-history';
it('restores ordered recent messages, preserving repeated text and excluding internal roles',()=>{
 expect(voiceHistory([{role:'system',content:'internal'},{role:'user',content:'yes'},{role:'assistant',content:'Saved'},{role:'user',content:'yes'}])).toEqual([{role:'user',text:'yes'},{role:'assistant',text:'Saved'},{role:'user',text:'yes'}]);
 const recent=voiceHistory(Array.from({length:70},(_,i)=>({role:'user',content:String(i)})));
 expect(recent).toHaveLength(50);expect(recent[0].text).toBe('20');
});
it('bounds payload length without cutting messages in half',()=>{
 expect(voiceHistory([{role:'user',content:'x'.repeat(64000)},{role:'assistant',content:'Recent'}])).toEqual([{role:'assistant',text:'Recent'}]);
});
