/** Conservative routing only; the model still extracts facts and confirmation is mandatory. */
export function isExplicitProfileUpdate(text:string){
 if(/^(?:what|which|do you remember|can you (?:recall|remember))\b/i.test(text.trim()))return false;
 if(/\b(?:description|goals?|bottlenecks?|tools|growth|appointment|scheduling|booking|calendar|email|notification|website|https?|phone)\b|\b(?:do not|don't|never)\s+(?:save|change|update)\b/i.test(text))return false;
 if(/\b(?:our|my)(?: business)? (?:name|industry|services|locations|hours|time ?zone) (?:is|are)\b|\bI work alone\b/i.test(text))return true;
 return /\b(?:save|prepare|update|change|correct|remember)\b/i.test(text)&&/\b(?:business (?:name|time zone|hours|industry)|our (?:services|locations|industry)|staff list|work alone)\b/i.test(text);
}

/** Limit a focused edit to fields actually mentioned by the owner. */
export function profileUpdateFields(text:string){
 const fields=[] as ('name'|'industry'|'services'|'locations'|'hours'|'timeZone'|'staff')[];
 if(/\bbusiness name\b|\b(?:business|company) (?:is )?(?:called|named)\b/i.test(text))fields.push('name');
 if(/\bindustry\b/i.test(text))fields.push('industry');
 if(/\bservices\b|\bproducts\b/i.test(text))fields.push('services');
 if(/\blocations?\b|\b(?:located|based) in\b|\b(?:serve|work) (?:customers )?(?:in|online)\b/i.test(text))fields.push('locations');
 if(/\bhours\b|\bopen(?:ing)?\b|\bclos(?:e|ing)\b/i.test(text))fields.push('hours');
 if(/\btime ?zone\b/i.test(text))fields.push('timeZone');
 if(/\bstaff\b|\bwork alone\b/i.test(text))fields.push('staff');
 return fields;
}
