import {describe,it,expect} from 'vitest';
import {DETECTOR_CONFIDENCE,confidenceFor} from '../src/proactive';

/* WS1 build 2 (2026-10-16): visual confidence — the payload carries
 * a 3-level mark mapped server-side from detector evidence; owners
 * never see a number (presentation law). */
describe('detector confidence mapping',()=>{
 it('specific recorded events are the strongest level',()=>{
  expect(confidenceFor('missed_call_followup')).toBe(3);
  expect(confidenceFor('unanswered_lead')).toBe(3);
 });
 it('patterns over real history are the middle level',()=>{
  expect(confidenceFor('no_show_risk')).toBe(2);
  expect(confidenceFor('lapsed_regular')).toBe(2);
 });
 it('the pace inference is the softest level',()=>{
  expect(confidenceFor('slow_day')).toBe(1);
 });
 it('every detector maps to exactly one of the three levels',()=>{
  for(const level of Object.values(DETECTOR_CONFIDENCE))expect([1,2,3]).toContain(level);
  expect(Object.keys(DETECTOR_CONFIDENCE)).toHaveLength(5);
 });
});
