/** Conservative fast path for explicit new-booking requests; never mutates setup. */
export function asksNewBooking(text:string){
 const request=text.trim();
 return /^(?:(?:please|can you|could you|would you|i (?:want|need|would like) (?:you )?to)\s+)*(?:book|schedule|create|prepare|propose|make|set up)\b[^.!?\n]{0,140}\b(?:appointment|booking|meeting)\b/i.test(request)
  && !/\b(?:reschedul|cancel|delet|rules|policy|policies|availability)\b/i.test(request.split(/[.!?\n]/)[0]);
}
/** Action-specific confirmations must never approve unrelated profile/settings edits. */
export function isBookingConfirmation(text:string){
 return /^(?:yes[,!]?\s+)?(?:book|confirm)\s+(?:it|that appointment|the appointment)[.!]?$/i.test(text.trim());
}
export function appointmentChangeConfirmation(text:string):'cancel'|'reschedule'|null{
 const match=/^(?:yes[,!]?\s+)?(cancel|reschedule)\s+(?:it|that appointment|the appointment)[.!]?$/i.exec(text.trim());
 return match?match[1].toLowerCase() as 'cancel'|'reschedule':null;
}
