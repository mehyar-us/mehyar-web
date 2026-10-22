import {describe,expect,it} from 'vitest';
import {
 resolveLanguage,esTemplates,smsTemplates,renderTextback,renderTextbackConfirm,renderReminder,
 esFollowupCard,esFillGapCard,esWinbackCard,esLeadReplyCard,esNoShowCard,
 esFillGapDraft,esWinbackDraft,esLeadReplyDraft,esAgoText,esBriefingCopy,
 esNotificationCopy,NOTIFICATION_COPY_ES,
} from '../src/i18n';
import {verticalProfile,VERTICAL_PROFILES} from '../src/verticals';
import {profileSchema} from '../src/memory';
import {growthMetricsInstruction,verticalIdentityBlock} from '../src/assistant-persona';

const verticals=Object.keys(VERTICAL_PROFILES);

describe('resolveLanguage',()=>{
 it('defaults anything that is not es to en',()=>{
  expect(resolveLanguage(undefined)).toBe('en');
  expect(resolveLanguage(null)).toBe('en');
  expect(resolveLanguage('en')).toBe('en');
  expect(resolveLanguage('fr')).toBe('en');
  expect(resolveLanguage('ES')).toBe('en');
  expect(resolveLanguage('es')).toBe('es');
 });
});

describe('esTemplates',()=>{
 it('covers every vertical in the file',()=>{
  for(const v of verticals){
   const pack=esTemplates(v);
   expect(pack.textback,'textback '+v).toContain('{business}');
   expect(pack.textbackConfirm,'confirm '+v).toBeTruthy();
   expect(pack.reminder,'reminder '+v).toContain('{business}');
   expect(pack.reminder,'reminder when '+v).toContain('{when}');
   expect(pack.nouns.appointments,'nouns '+v).toBeTruthy();
   expect(pack.nouns.customers,'nouns '+v).toBeTruthy();
  }
 });
 it('falls back to other for unknown verticals',()=>{
  expect(esTemplates('nope')).toEqual(esTemplates('other'));
  expect(esTemplates(null)).toEqual(esTemplates('other'));
 });
 it('has no English leftovers',()=>{
  const banned=['Sorry we missed your call','Reply YES','Reply STOP','Reply CANCEL','Reminder:','Thanks!','Thank you'];
  for(const v of verticals){
   const pack=esTemplates(v);
   for(const text of [pack.textback,pack.textbackConfirm,pack.reminder])
    for(const phrase of banned)expect(text,`"${phrase}" in ${v}`).not.toContain(phrase);
  }
 });
 it('reads like natural owner Spanish',()=>{
  expect(esTemplates('restaurant').textback).toContain('¿Quiere reservar una mesa?');
  expect(esTemplates('salon').reminder).toContain('Responda CANCELAR');
  expect(esTemplates('plumbing_hvac').textbackConfirm).toContain('15 minutos');
 });
});

describe('render helpers',()=>{
 it('renderTextback fills {business} and leaves no placeholders',()=>{
  const text=renderTextback('salon','es','Bella Spa');
  expect(text).toContain('Bella Spa');
  expect(text).not.toContain('{business}');
  expect(text).toContain('Responda SÍ');
 });
 it('renderTextbackConfirm has no placeholders',()=>{
  expect(renderTextbackConfirm('dental','es')).not.toMatch(/[{}]/);
 });
 it('renderReminder fills {business} and {when}',()=>{
  const text=renderReminder('restaurant','es','Taquería Luna','mañana a las 7');
  expect(text).toContain('Taquería Luna');
  expect(text).toContain('mañana a las 7');
  expect(text).not.toMatch(/[{}]/);
 });
 it('english path returns the vertical profile templates untouched',()=>{
  for(const v of verticals){
   const en=smsTemplates(v,'en');
   const vp=verticalProfile(v);
   expect(en.textback).toBe(vp.textbackTemplate);
   expect(en.textbackConfirm).toBe(vp.textbackConfirmTemplate);
   expect(en.reminder).toBe(vp.reminderTemplate);
  }
 });
});

describe('suggestion card copy (es)',()=>{
 const now=Date.now();
 it('follow-up card is Spanish',()=>{
  const copy=esFollowupCard('+15551234567',esAgoText(now-5*60000,now));
  expect(copy.title).toBe('Una llamada perdida necesita respuesta');
  expect(copy.body).toContain('+15551234567');
  expect(copy.body).toContain('hace 5 min');
  expect(copy.body).not.toContain('never got a text-back');
 });
 it('fill-gap card is Spanish',()=>{
  const copy=esFillGapCard(3,4,'clientes');
  expect(copy.title).toContain('3 horas lentas');
  expect(copy.body).toContain('4 clientes');
 });
 it('win-back card is Spanish',()=>{
  const copy=esWinbackCard(5,'invitados',45);
  expect(copy.title).toContain('5 invitados');
  expect(copy.body).toContain('45+ días');
 });
 it('lead-reply card is Spanish',()=>{
  const copy=esLeadReplyCard('+15559876543',esAgoText(now-3600000,now));
  expect(copy.title).toBe('Contacto sin responder');
  expect(copy.body).toContain('hace 1 h');
 });
 it('no-show card is Spanish',()=>{
  const copy=esNoShowCard('María','mañana a las 3');
  expect(copy.title).toContain('Riesgo de no asistencia: María');
  expect(copy.body).toContain('mañana a las 3');
 });
 it('drafts keep {name}/{business} placeholders and carry the STOP footer',()=>{
  for(const draft of [esFillGapDraft(),esWinbackDraft('cita'),esLeadReplyDraft()]){
   expect(draft).toContain('Responda STOP para no recibir más mensajes.');
   expect(draft).not.toContain('Reply YES');
  }
  expect(esFillGapDraft()).toContain('{name}');
  expect(esWinbackDraft('reserva')).toContain('su reserva');
 });
});

describe('briefing copy (es)',()=>{
 it('translates nouns per vertical',()=>{
  expect(esTemplates('restaurant').nouns).toEqual({appointments:'reservas',customers:'invitados',booking:'reserva'});
  expect(esTemplates('dental').nouns.customers).toBe('pacientes');
  expect(esTemplates('salon').nouns.appointments).toBe('citas');
 });
 it('builds Spanish copy lines with singular/plural handling',()=>{
  const one=esBriefingCopy(1,1,0,'citas');
  expect(one.yesterday).toBe('1 cita ayer');
  expect(one.today).toBe('1 cita hoy');
  const many=esBriefingCopy(3,5,2,'reservas');
  expect(many.yesterday).toBe('3 reservas ayer, 2 no asistencias');
  expect(many.today).toBe('5 reservas hoy');
  expect(esBriefingCopy(0,0,1,'visitas').today).toBe('No hay visitas hoy');
  expect(esBriefingCopy(2,0,1,'visitas').yesterday).toBe('2 visitas ayer, 1 no asistencia');
 });
});

describe('notification copy (es)',()=>{
 it('covers every bell kind with no English leftovers',()=>{
  const kinds=['phone_call_review','scheduled_check_failed','onboarding','calendar_connection','missed_call_texted','missed_call','missed_call_simulated','proactive_suggestion','proactive_briefing'];
  expect(Object.keys(NOTIFICATION_COPY_ES).sort()).toEqual(kinds.sort());
  for(const kind of kinds){
   const copy=esNotificationCopy(kind)!;
   expect(copy.title,'title '+kind).toBeTruthy();
   expect(copy.message,'message '+kind).toBeTruthy();
  }
 });
 it('keeps the honest test-mode distinction in Spanish',()=>{
  const copy=esNotificationCopy('missed_call_simulated')!;
  expect(copy.title).toContain('no se envió SMS');
 });
 it('returns null for unknown kinds',()=>{
  expect(esNotificationCopy('nope')).toBeNull();
 });
});

describe('profileSchema language field',()=>{
 it('accepts es and defaults to en when omitted',()=>{
  expect(profileSchema.parse({name:'Tacos',language:'es'}).language).toBe('es');
  expect(profileSchema.parse({name:'Tacos'}).language).toBe('en');
  expect(profileSchema.parse({name:'Tacos',language:'en'}).language).toBe('en');
 });
 it('rejects anything outside en/es',()=>{
  expect(()=>profileSchema.parse({name:'Tacos',language:'fr'})).toThrow();
  expect(()=>profileSchema.parse({name:'Tacos',language:''})).toThrow();
 });
 it('fills the default on parse (so stored profiles always carry it)',()=>{
  // Note: .default('en') means parse({}) no longer throws on the non-empty
  // refine — the default counts as a field. Empty *patches* still fail closed
  // upstream (the profile-intake tool requires at least one supplied fact).
  expect(profileSchema.parse({}).language).toBe('en');
 });
});

describe('persona language wiring',()=>{
 const transcript='how do we grow this month';
 it('growthMetricsInstruction frames in Spanish for language es',()=>{
  const es=growthMetricsInstruction({vertical:'salon',language:'es'},transcript)!;
  expect(es).toContain('Instrucción para esta respuesta: responda en español');
  expect(es).toContain('Rebooking rate'); // KPI labels stay as the vertical defines them
  expect(es).not.toContain('Instruction for this answer');
  const en=growthMetricsInstruction({vertical:'salon'},transcript)!;
  expect(en).toContain('Instruction for this answer');
  expect(en).not.toContain('Instrucción');
 });
 it('verticalIdentityBlock adds the Spanish line only for es',()=>{
  const esBlock=verticalIdentityBlock({vertical:'restaurant',language:'es'});
  expect(esBlock).toContain('Customer language: Spanish');
  expect(esBlock).toContain('Respond to the owner in Spanish');
  const enBlock=verticalIdentityBlock({vertical:'restaurant'});
  expect(enBlock).not.toContain('Customer language: Spanish');
 });
});
