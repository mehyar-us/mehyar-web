import {createElement,CalendarDays,ClipboardCheck,PhoneCall,UsersRound,MapPin,Handshake,TrendingUp,Tags,ListChecks,Clock,Wallet,UserCheck,ArrowRight,RefreshCw,Sparkles,MessageCircle,CheckCheck,ArrowLeft,Check,ArrowUpRight,RotateCw} from 'lucide';
import './playbook-visuals.css';

type Icon=Parameters<typeof createElement>[0];
const previews:Record<string,{icon:Icon;tone:string;steps:string[]}>= {
 'daily-priorities':{icon:ListChecks,tone:'blue',steps:['Review','Prioritize','Plan']},
 'callback-follow-up':{icon:PhoneCall,tone:'mint',steps:['Requests','Draft','Review']},
 'booking-readiness':{icon:CalendarDays,tone:'blue',steps:['Bookings','Prepare','Review']},
 'customer-retention':{icon:UsersRound,tone:'rose',steps:['Customers','Ideas','Draft']},
 'local-visibility':{icon:MapPin,tone:'sand',steps:['Facts','Compare','Draft']},
 'team-handoff':{icon:Handshake,tone:'lilac',steps:['Priorities','Owners','Draft']},
 'weekly-growth':{icon:TrendingUp,tone:'mint',steps:['Goals','Experiment','Measure']},
 'service-offer-review':{icon:Tags,tone:'sand',steps:['Offer','Audience','Draft']},
};
export function playbookIcon(icon:Icon,className=''){
 const element=createElement(icon);element.classList.add('playbook-icon');if(className)element.classList.add(className);element.setAttribute('aria-hidden','true');element.setAttribute('focusable','false');return element;
}
/** A visual outline of a template, never a claimed completed action or business metric. */
export function playbookThumbnail(id:string){
 const item=previews[id]??previews['daily-priorities'],thumbnail=document.createElement('div');thumbnail.className=`playbook-thumbnail tone-${item.tone}`;thumbnail.setAttribute('aria-hidden','true');
 const mark=document.createElement('span');mark.className='playbook-thumbnail-mark';mark.append(playbookIcon(item.icon));
 const flow=document.createElement('div');flow.className='playbook-mini-flow';
 for(const [index,label] of item.steps.entries()){
  if(index)flow.append(playbookIcon(ArrowRight,'playbook-flow-arrow'));
  const step=document.createElement('span');step.className='playbook-mini-step';step.textContent=label;flow.append(step);
 }
 thumbnail.append(mark,flow);return thumbnail;
}
export function playbookMetricIcon(key:string){
 const icons:Record<string,Icon>={open_tasks:ClipboardCheck,overdue_tasks:Clock,pending_callbacks:PhoneCall,bookings_next_7_days:CalendarDays,saved_customers:UsersRound,customers_with_contact:UserCheck,revenue:Wallet};
 return playbookIcon(icons[key]??ListChecks);
}
export function playbookTemplateIcon(id:string){return playbookIcon(previews[id]?.icon??Sparkles);}
export function playbookActionIcon(label:string){
 const icon=label==='Refresh playbook'?RefreshCw:label==='Back'?ArrowLeft:label==='Confirm settings'?Check:label==='Mark this review read'?CheckCheck:label==='Try again'?RotateCw:label.startsWith('Draft')||label.startsWith('Prepare a draft')?MessageCircle:label.startsWith('Work through')?ArrowUpRight:Sparkles;
 return playbookIcon(icon);
}
