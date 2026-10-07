import {it,expect} from 'vitest';
import {clockMinutes,schedulingDetailsInputSchema} from '../src/scheduling-input';

it('distinguishes explicit no staff or closures from unknown answers and rejects contradictions',()=>{
 expect(schedulingDetailsInputSchema.parse({noStaffChoice:true,noClosedDates:true})).toEqual({staff:[],closedDates:[]});
 expect(schedulingDetailsInputSchema.parse({minimumNoticeMinutes:60})).toEqual({minimumNoticeMinutes:60});
 for(const input of [{noStaffChoice:false},{noClosedDates:false},{noStaffChoice:true,staff:[{name:'Alex'}]},{noClosedDates:true,closedDates:['2026-12-25']}])expect(schedulingDetailsInputSchema.safeParse(input).success).toBe(false);
});

it('converts explicit AM/PM and 24-hour clock values without model arithmetic',()=>{
 for(const [input,expected] of [['nine AM',540],['five PM',1020],['9:30 a.m.',570],['12 AM',0],['12 PM',720],['noon',720],['midnight',0],['23:59',1439],['24:00',1440],['five in the afternoon',1020]] as const)expect(clockMinutes(input)).toBe(expected);
});
it('rejects ambiguous and malformed clock input instead of guessing',()=>{
 for(const input of ['9','five','13 AM','0 PM','25:00','17:60','9 AM tomorrow','1:5 PM','-1:00','1.0 AM','1.2 PM'])expect(clockMinutes(input)).toBeNull();
});
it('turns Monday 9 AM–5 PM into the correct local interval and preserves unknown rules',()=>{
 expect(schedulingDetailsInputSchema.parse({weeklyHours:[{day:'Monday',opens:'nine AM',closes:'five PM'}]})).toEqual({weeklyHours:[{day:1,startMinute:540,endMinute:1020}]});
 expect(schedulingDetailsInputSchema.parse({staff:[{name:'Alex',weeklyHours:[{day:'Saturday',opens:'09:30',closes:'noon'}]}]})).toEqual({staff:[{name:'Alex',weeklyHours:[{day:6,startMinute:570,endMinute:720}]}]});
 expect(schedulingDetailsInputSchema.parse({weeklyHours:[{day:'Monday',opens:'9 PM',closes:'midnight'}]})).toEqual({weeklyHours:[{day:1,startMinute:1260,endMinute:1440}]});
});
it('retains overlap, overnight, extra-field and empty-patch validation after conversion',()=>{
 for(const input of [{},{weeklyHours:[{day:'Monday',opens:'5 PM',closes:'9 AM'}]},{weeklyHours:[{day:'Monday',opens:'9 AM',closes:'5 PM'},{day:'Monday',opens:'noon',closes:'6 PM'}]},{weeklyHours:[{day:0,startMinute:540,endMinute:1020}]},{weeklyHours:[{day:'Monday',opens:'9 AM',closes:'5 PM',offset:120}]}])expect(schedulingDetailsInputSchema.safeParse(input).success).toBe(false);
});
