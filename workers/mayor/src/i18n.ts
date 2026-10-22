import {z} from 'zod';
import {verticalProfile,type Vertical} from './verticals';

/** Crew 6c — Spanish language support.
 *
 * Deterministic template-based Spanish: every customer-facing template has a
 * hand-written Spanish twin. The model is never asked to translate ad hoc.
 *
 * Coverage: SMS text-backs / confirmations / reminders (per vertical),
 * suggestion-card titles/bodies/drafts, morning-briefing nouns + copy lines,
 * bell-notification titles/messages.
 *
 * Explicitly NOT translated here: phone-call voice prompts and TTS (English
 * voice pipeline), the owner dashboard chrome, and KPI labels (the vertical
 * defines them; only the framing sentence around them is translated). */

export const languageSchema=z.enum(['en','es']);
export type Language=z.infer<typeof languageSchema>;

/** Defensive language read: anything that isn't 'es' falls back to 'en'. */
export function resolveLanguage(value:unknown):Language{
 return value==='es'?'es':'en';
}

const STOP_ES='Responda STOP para no recibir más mensajes.';

export interface EsNouns{
 /** Plural appointments noun, e.g. 'reservas'. */
 appointments:string;
 /** Plural customers noun, e.g. 'invitados'. */
 customers:string;
 /** Singular booking word used inside drafts, e.g. 'reserva'. */
 booking:string;
}

export interface EsSmsPack{
 textback:string;
 textbackConfirm:string;
 reminder:string;
 nouns:EsNouns;
}

const ES_SMS:Record<Vertical,EsSmsPack>={
 salon:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere reservar una cita? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: tiene una cita en {business} {when}. Responda CANCELAR para cancelarla.',
  nouns:{appointments:'citas',customers:'clientes',booking:'cita'}},
 restaurant:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere reservar una mesa? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: su reserva en {business} es {when}. Responda CANCELAR para cancelarla.',
  nouns:{appointments:'reservas',customers:'invitados',booking:'reserva'}},
 plumbing_hvac:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Es urgente? Responda SÍ y le agendamos de inmediato. '+STOP_ES,
  textbackConfirm:'Entendido — le llamamos en menos de 15 minutos.',
  reminder:'Recordatorio: su visita de servicio con {business} es {when}. Responda CANCELAR para reprogramarla.',
  nouns:{appointments:'trabajos',customers:'clientes',booking:'trabajo'}},
 dental:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere agendar una visita? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: su visita en {business} es {when}. Responda CANCELAR para cancelarla.',
  nouns:{appointments:'visitas',customers:'pacientes',booking:'visita'}},
 auto_repair:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere agendar un servicio? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: su servicio en {business} es {when}. Responda CANCELAR para cancelarlo.',
  nouns:{appointments:'servicios',customers:'clientes',booking:'cita de servicio'}},
 pet_grooming:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere agendar el aseo de su mascota? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: la cita de aseo de su mascota en {business} es {when}. Responda CANCELAR para cancelarla.',
  nouns:{appointments:'citas',customers:'clientes',booking:'cita'}},
 med_spa:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! ¿Quiere agendar su tratamiento? Responda SÍ y le buscamos un horario. '+STOP_ES,
  textbackConfirm:'¡Gracias! Le escribimos en un momento con los horarios disponibles.',
  reminder:'Recordatorio: su tratamiento en {business} es {when}. Responda CANCELAR para cancelarlo. Si no puede asistir, avísenos con anticipación.',
  nouns:{appointments:'citas',customers:'clientes',booking:'tratamiento'}},
 other:{textback:'Hola, le escribe {business}. ¡Perdón que no pudimos contestar! Responda SÍ y nos comunicamos con usted en breve. '+STOP_ES,
  textbackConfirm:'¡Gracias! Nos comunicamos con usted en breve.',
  reminder:'Recordatorio: tiene una cita en {business} {when}. Responda CANCELAR para cancelarla.',
  nouns:{appointments:'citas',customers:'clientes',booking:'cita'}},
};

/** The Spanish SMS pack for a vertical. Unknown verticals fall back to 'other'. */
export function esTemplates(vertical:string|undefined|null):EsSmsPack{
 return ES_SMS[verticalProfile(vertical).vertical];
}

/** The localized SMS template triple: English from the vertical profile, or the
 * deterministic Spanish pack. Placeholders ({business}, {when}) are preserved
 * by the render helpers below. */
export function smsTemplates(vertical:string|undefined|null,language:Language):{textback:string;textbackConfirm:string;reminder:string}{
 if(language!=='es'){
  const v=verticalProfile(vertical);
  return {textback:v.textbackTemplate,textbackConfirm:v.textbackConfirmTemplate,reminder:v.reminderTemplate};
 }
 const pack=esTemplates(vertical);
 return {textback:pack.textback,textbackConfirm:pack.textbackConfirm,reminder:pack.reminder};
}

/** Rendered text-back with {business} filled. */
export function renderTextback(vertical:string|undefined|null,language:Language,businessName:string):string{
 return smsTemplates(vertical,language).textback.replace('{business}',businessName);
}
/** Rendered text-back confirmation (no placeholders). */
export function renderTextbackConfirm(vertical:string|undefined|null,language:Language):string{
 return smsTemplates(vertical,language).textbackConfirm;
}
/** Rendered reminder with {business} and {when} filled. */
export function renderReminder(vertical:string|undefined|null,language:Language,businessName:string,when:string):string{
 return smsTemplates(vertical,language).reminder.replace('{business}',businessName).replace('{when}',when);
}

/* ---------------- suggestion-card copy (Spanish) ---------------- */

/** Spanish "x min ago". Mirrors agoText in proactive-detectors. Pure. */
export function esAgoText(ms:number,nowMs:number):string{
 const mins=Math.max(1,Math.round((nowMs-ms)/60000));
 return mins<60?`hace ${mins} min`:`hace ${Math.round(mins/60)} h`;
}

export function esFollowupCard(callerNumber:string,ago:string):{title:string;body:string}{
 return {title:'Una llamada perdida necesita respuesta',
  body:`Una llamada de ${callerNumber} ${ago} quedó sin respuesta — ¿la enviamos ahora?`};
}
export function esFillGapCard(hours:number,n:number,cust:string):{title:string;body:string}{
 const s=hours===1?'':'s';
 return {title:`Ocupe ${hours} hora${s} lenta${s} de mañana`,
  body:`${hours} hora${s} lenta${s} mañana sin nada agendado — ¿le enviamos este mensaje a ${n} ${cust}?`};
}
export function esWinbackCard(n:number,cust:string,days:number):{title:string;body:string}{
 return {title:`Recupere ${n} ${cust}`,
  body:`${n} ${cust} no han reservado en ${days}+ días — ¿enviamos este mensaje de recuperación?`};
}
export function esLeadReplyCard(fromNumber:string,ago:string):{title:string;body:string}{
 return {title:'Contacto sin responder',
  body:`Un mensaje de ${fromNumber} ${ago} no tiene respuesta — ¿enviamos este seguimiento?`};
}
export function esNoShowCard(customerName:string,when:string):{title:string;body:string}{
 return {title:`Riesgo de no asistencia: ${customerName}`,
  body:`${customerName} ya faltó antes y no tiene recordatorio para ${when} — ¿le enviamos un recordatorio ahora?`};
}

/** Draft SMS bodies for suggestion cards (Spanish). {name} and {business} are
 * filled by the existing personalize() helper. */
export function esFillGapDraft():string{
 return `Hola {name}, ¡le escribe {business}! Tenemos algunos espacios libres mañana — ¿le interesa? Responda SÍ y le buscamos un horario. ${STOP_ES}`;
}
export function esWinbackDraft(bookingSingular:string):string{
 return `Hola {name}, ¡le escribe {business}! Hace tiempo que no sabemos de usted. ¿Agendamos su ${bookingSingular}? Responda SÍ y le buscamos un horario. ${STOP_ES}`;
}
export function esLeadReplyDraft():string{
 return `Hola, le escribe {business} — ¡gracias por escribirnos! Perdón por la demora — ¿en qué le podemos ayudar? ${STOP_ES}`;
}

/* ---------------- morning-briefing copy (Spanish) ---------------- */

const singularOf=(n:number,plural:string)=>n===1?plural.replace(/s$/,''):plural;

/** Spanish briefing copy lines. Mirrors the English construction in
 * buildBriefing (proactive.ts). Pure. */
export function esBriefingCopy(kept:number,apptsToday:number,noShowCount:number,appointmentsPlural:string):{yesterday:string;today:string}{
 return {
  yesterday:`${kept} ${singularOf(kept,appointmentsPlural)} ayer${noShowCount?`, ${noShowCount} ${noShowCount===1?'no asistencia':'no asistencias'}`:''}`,
  today:apptsToday?`${apptsToday} ${singularOf(apptsToday,appointmentsPlural)} hoy`:`No hay ${appointmentsPlural} hoy`,
 };
}

/* ---------------- bell-notification copy (Spanish) ---------------- */

export interface EsNotificationCopy{title:string;message:string}

/** Spanish twins of the notification content table in notifications.ts.
 * Actions (account/chat/missed-calls/...) are language-neutral and stay in
 * the English table. */
export const NOTIFICATION_COPY_ES:Record<string,EsNotificationCopy>={
 phone_call_review:{title:'Una llamada telefónica necesita su atención',
  message:'The Mayor no pudo confirmar que terminó una llamada de Telnyx. Revise las llamadas activas en su cuenta de Telnyx y termine cualquier llamada no deseada. Pueden seguir cobrándole hasta que termine la llamada.'},
 scheduled_check_failed:{title:'Su revisión automática no pudo completarse',
  message:'The Mayor no pudo verificar su cuenta ni su calendario seleccionado. Revise su conexión y el estado de la última revisión en Cuenta.'},
 onboarding:{title:'Cuéntele a The Mayor sobre su negocio',
  message:'Comparta el nombre de su negocio y lo que ofrece, o indique un sitio web. Revise los datos sugeridos antes de guardarlos.'},
 calendar_connection:{title:'Su conexión de calendario necesita atención',
  message:'Revise su calendario seleccionado en Cuenta. Vuelva a conectarlo o seleccionarlo antes de depender de las citas.'},
 missed_call_texted:{title:'Llamada perdida recuperada',
  message:'Se envió un mensaje de respuesta a quien llamó. Revíselo en Llamadas perdidas.'},
 missed_call:{title:'Llamada perdida — respuesta lista',
  message:'Se perdió una llamada. Abra Llamadas perdidas para revisarla y enviar la respuesta.'},
 // Honest test-mode copy (compliance item 12): never imply a real SMS was sent.
 missed_call_simulated:{title:'Respuesta de prueba registrada — no se envió SMS',
  message:'La respuesta simulada de esta llamada de prueba quedó registrada en el registro de SMS. No se envió nada a un teléfono real.'},
 proactive_suggestion:{title:'Hay una sugerencia lista',
  message:'The Mayor encontró una forma de llenar horas lentas o recuperar negocio. Revise la sugerencia.'},
 proactive_briefing:{title:'Su resumen de la mañana está listo',
  message:'Ayer, hoy y oportunidades abiertas de un vistazo.'},
};

/** Spanish notification copy for a kind, or null when the kind has no twin. */
export function esNotificationCopy(kind:string):EsNotificationCopy|null{
 return NOTIFICATION_COPY_ES[kind]??null;
}
