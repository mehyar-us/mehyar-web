import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessAcousticLatency} from '../../scripts/assess-acoustic-latency.mjs';
// Synthetic annotations only. These do not constitute measured latency evidence.
function fixture(){
 let hash=0;
 return {schemaVersion:1,measurement:'annotated_acoustic_recording',sessions:['desktop','mobile'].flatMap(deviceClass=>['baseline','impaired'].map(network=>({
  id:`${deviceClass}-${network}`,deviceClass,network,device:'synthetic',region:'synthetic',addedRttMs:network==='impaired'?150:0,downlinkKbps:1000,uplinkKbps:256,measuredAt:'2026-09-28T00:00:00Z',
  samples:['response','interruption'].flatMap(kind=>Array.from({length:30},(_,i)=>({id:`${kind}-${i}`,kind,outcome:'success',recordingSha256:(++hash).toString(16).padStart(64,'0'),startMs:1000,endMs:1000+(kind==='response'?1000:200)}))),
 })))};
}
test('assesses complete per-device/network groups with nearest-rank percentiles',()=>{
 const report=assessAcousticLatency(fixture());assert.equal(report.status,'passed');
 assert.equal(report.results[0].metrics.response.p95Ms,1000);
 assert.equal(report.results[0].metrics.interruption.p95Ms,200);
});
test('does not hide failures behind fast successful percentiles',()=>{
 const data=fixture();data.sessions[0].samples[0].outcome='failure';delete data.sessions[0].samples[0].endMs;
 const report=assessAcousticLatency(data);assert.equal(report.status,'failed');assert.equal(report.results[0].metrics.response.failures,1);
});
test('fails a slow tail or inadequate impaired-network setting',()=>{
 const data=fixture();data.sessions[0].samples[28].endMs=4000;data.sessions[0].samples[29].endMs=4000;
 assert.equal(assessAcousticLatency(data).status,'failed');
 const network=fixture();network.sessions[1].addedRttMs=0;assert.equal(assessAcousticLatency(network).status,'failed');
 const bandwidth=fixture();bandwidth.sessions[1].downlinkKbps=10000;assert.equal(assessAcousticLatency(bandwidth).status,'failed');
});
test('reports absent conditions and insufficient samples as incomplete',()=>{
 const data=fixture();data.sessions.pop();assert.equal(assessAcousticLatency(data).status,'incomplete');
 const few=fixture();few.sessions[0].samples=[];const report=assessAcousticLatency(few);
 assert.equal(report.status,'incomplete');assert.equal(report.results[0].metrics.response.p50Ms,null);
});
test('rejects mixed server metrics, duplicate evidence and invalid timestamp ordering',()=>{
 assert.throws(()=>assessAcousticLatency({schemaVersion:1,measurement:'server_voice_pipeline'}));
 const duplicate=fixture();duplicate.sessions[0].samples.push(duplicate.sessions[0].samples[0]);assert.throws(()=>assessAcousticLatency(duplicate));
 const wrong=fixture();wrong.sessions[0].samples[0].endMs=10;assert.throws(()=>assessAcousticLatency(wrong));
});
