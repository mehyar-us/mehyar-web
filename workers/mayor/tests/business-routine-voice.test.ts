import {expect,it} from 'vitest';
import {asksRoutineRun,asksRoutineSchedule,businessBriefReadback} from '../src/business-routine-voice';
it('separates fresh daily advice from an explicit saved run or automatic schedule',()=>{
 for(const text of ['Help me plan today','Show my priorities','Do not run a business review'])expect(asksRoutineRun(text)).toBe(false);
 for(const text of ['Run my business review','Generate a daily brief','Review my business playbook'])expect(asksRoutineRun(text)).toBe(true);
 for(const text of ['Show my daily priorities','Do not schedule daily briefs','Never enable routines'])expect(asksRoutineSchedule(text)).toBe(false);
 for(const text of ['Enable daily briefs at 9','Pause my business routines','Set up daily priorities'])expect(asksRoutineSchedule(text)).toBe(true);
 expect(asksRoutineSchedule('9 am New York','What time should the business brief run?')).toBe(true);
 expect(asksRoutineSchedule('9 am New York','What time does your shop open?')).toBe(false);
});
it('reads actual evidence and a recorded timestamp rather than implying a fresh or external result',()=>{
 const text=businessBriefReadback({generatedAt:'2026-09-01T09:00:00Z',templateIds:['daily-priorities'],summary:'1 overdue task.',metrics:[],priorities:[{id:'task:1',title:'Prepare estimate',detail:'Overdue task.',source:{kind:'task',id:'1'}}],suggestions:[],gaps:[],scope:'Saved records only; no inbox or reviews monitored.'});
 expect(text).toContain('recorded 2026-09-01');expect(text).toContain('Prepare estimate: Overdue task.');expect(text).toContain('no inbox or reviews monitored');expect(text).not.toContain('today');
});
