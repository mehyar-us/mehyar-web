import {it,expect} from 'vitest';
import {createVoiceDiagnostics} from '../web/voice-diagnostics';
const sample=(id:number,extra:Record<string,unknown>={})=>({turnId:`turn-${id}`,source:'speech',outcome:'completed',turnTotalMs:id,finalInputToFirstAudioMs:id,...extra});
it('requires explicit collection and strips all content and identities from exports',()=>{
 const capture=createVoiceDiagnostics();capture.record(sample(1));expect(capture.count).toBe(0);
 capture.start();capture.record(sample(2,{transcript:'PRIVATE WORDS',audio:'PRIVATE AUDIO',accountEmail:'private@example.test',tenantId:'private-tenant',data:{secret:'private-key'}}));
 const report=JSON.stringify(capture.report());expect(report).not.toMatch(/PRIVATE|private-|example.test|turn-2/);expect(capture.count).toBe(1);
 capture.stop();capture.record(sample(3));expect(capture.count).toBe(1);
 capture.clear();expect(capture.count).toBe(0);expect(capture.active).toBe(false);
});
it('keeps text and speech separate, reports failures and never treats missing timing as zero',()=>{
 const capture=createVoiceDiagnostics();capture.start();
 for(let i=1;i<=20;i++)capture.record(sample(i));
 capture.record(sample(21,{source:'text',finalInputToFirstAudioMs:undefined}));
 capture.record(sample(22,{outcome:'tts_error',finalInputToFirstAudioMs:undefined}));
 const groups=capture.report().groups;
 expect(groups.speech.completedTurnTimings.finalInputToFirstAudioMs).toEqual({samples:20,p50Ms:10,p95Ms:19});
 expect(groups.text.completedTurnTimings.finalInputToFirstAudioMs).toEqual({samples:0,p50Ms:null,p95Ms:null});
 expect(groups.speech.outcomes.tts_error).toBe(1);expect(groups.speech.turns).toBe(21);
});
it('bounds memory, deduplicates a connection and accepts reused SDK IDs after reconnect',()=>{
 const capture=createVoiceDiagnostics();capture.start();capture.record(sample(1));capture.record(sample(1));expect(capture.count).toBe(1);
 capture.newConnection();capture.record(sample(1));expect(capture.count).toBe(2);
 for(let i=2;i<=210;i++)capture.record(sample(i));
 expect(capture.count).toBe(200);expect(capture.report().droppedTurns).toBe(11);
 capture.start();expect(capture.count).toBe(0);expect(capture.report().droppedTurns).toBe(0);
});
it('rejects malformed required metrics and omits invalid optional durations',()=>{
 const capture=createVoiceDiagnostics();capture.start();
 for(const value of [null,sample(1,{turnTotalMs:NaN}),sample(2,{source:'unknown'}),sample(3,{turnTotalMs:-1}),sample(4,{turnTotalMs:900001})])capture.record(value);
 capture.record(sample(5,{finalInputToFirstAudioMs:Infinity,ttsWorkMs:-20}));
 expect(capture.report().rejectedRecords).toBe(5);expect(capture.report().samples).toEqual([{source:'speech',outcome:'completed',turnTotalMs:5}]);
});
