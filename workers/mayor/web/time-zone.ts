export function detectedTimeZone():string|null {
 try { const zone=Intl.DateTimeFormat().resolvedOptions().timeZone; return zone&&zone.length<=100?zone:null; } catch { return null; }
}
export function createTimeZoneSuggestion(ask:(message:string)=>void){
 const element=document.createElement('div');element.className='account-card';
 const zone=detectedTimeZone(),label=document.createElement('p'),use=document.createElement('button');
 label.textContent=zone?`Your device time zone: ${zone.replaceAll('_',' ')}. Use this for your business, or tell The Mayor a different location.`:'Your device did not provide a time zone. Tell The Mayor where your business operates.';
 use.type='button';use.className='secondary';use.textContent='Use my detected time zone';use.hidden=!zone;use.onclick=()=>ask(`Please set my business time zone to ${zone}. Prepare it for confirmation.`);
 element.append(label,use);return {element,ready(value:boolean){use.disabled=!value;}};
}
