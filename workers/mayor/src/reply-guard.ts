/** Completion acknowledgements belong to verified server handlers, never model prose. */
export function assertReadOnlyReply(text:string){
 const action='(?:prepared|proposed|saved|updated|changed|set|booked|scheduled|rescheduled|cancelled|canceled|deleted|enabled|disabled|connected|sent|created|activated|initiated|started|configured)';
 const claims=[new RegExp(`\\b(?:I|we)(?:['’]ve| have| just| successfully)?\\s+${action}\\b`,'i'),new RegExp(`\\b(?:has|have|had)\\s+been\\s+(?:successfully\\s+)?${action}\\b`,'i'),new RegExp(`\\b(?:will|shall)\\s+be\\s+(?:automatically\\s+|successfully\\s+)?${action}\\b`,'i'),new RegExp(`^\\s*(?:successfully\\s+)?${action}[.!]`,'i')];
 if(claims.some(pattern=>pattern.test(text)))throw new Error('Read-only reply cannot announce a completed action. No action was performed by reply. Use the appropriate proposal tool for changes, including proposeProfile for business time zone or staff, and wait for separate confirmation.');
}
