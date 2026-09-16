import {AUTOMATIONS,getIndustryPack,INDUSTRY_PACKS} from './automations';
import {getPlan} from './catalog';

export function briefRecommendations(fields:{industryPack:string;bookingSystem:string;serviceDuration:string}){
  const industry=getIndustryPack(fields.industryPack);
  const ids=industry?.defaultScope==='public_faq_only'?['front-desk.faq','setup.first-preview','setup.missing-information']:
    industry?industry.defaultAutomationIds.slice(0,3):['email.draft',fields.bookingSystem||fields.serviceDuration?'appointments.availability':'email.summary','email.unanswered-followup'];
  const examples:Record<string,string>={
    'email.draft':'Prepare a reply to a customer question for your review.',
    'email.summary':'Show the key points and open questions in an authorized email thread.',
    'email.unanswered-followup':'Prepare an allowed follow-up after checking that the inquiry is still unanswered.',
    'appointments.availability':'Suggest open times from an approved calendar without making a booking.',
    'appointments.book':'Preview a requested appointment against approved staff and resource availability.',
    'front-desk.contact':'Preview collecting the minimum contact details needed for an authorized inquiry.',
    'front-desk.faq':industry?.defaultScope==='public_faq_only'?'Draft an answer about published opening hours; refer patient questions to staff.':'Draft an answer from approved public business information.',
    'front-desk.assignment':'Preview routing an inquiry to the assigned team member.',
    'sales.qualify':'Preview the owner-approved questions needed to route a customer inquiry.',
    'sales.booking-handoff':'Prepare a booking handoff for the responsible team member.',
    'voice.intake':'Preview a caller intake script and human escalation route.',
    'email.attachments':'Preview routing a permitted attachment for safe document intake.',
    'documents.checklist':'Prepare a checklist of owner-approved document requirements.',
    'appointments.confirmation':'Preview a confirmation using a verified appointment receipt.',
    'support.order-lookup':'Preview a status response from an authorized order record.',
    'setup.first-preview':'Preview a public-information FAQ response with no patient data or external action.',
    'setup.missing-information':'Confirm missing public business details and the staff handoff destination without collecting patient data.',
  };
  return {
    industry:industry?{id:industry.id,name:industry.name,scope:industry.defaultScope,requiredFacts:industry.requiredFacts}:null,
    industryOptions:INDUSTRY_PACKS.map(pack=>({id:pack.id,name:pack.name})),
    recommendations:ids.map((id,index)=>{
      const definition=AUTOMATIONS.find(item=>item.id===id)!,plan=getPlan(definition.eligibility.plans[0])!;
      return {id,priority:index+1,name:definition.name,basis:industry?'owner_selected_industry':'owner_brief_rule',proposed:true,executionEnabled:false,
        permissions:definition.permissions,prerequisites:[...new Set([...definition.eligibility.prerequisites,...(industry?.prerequisites??[]),...(industry?.extraReleaseGates??[])])],
        plan:{id:plan.id,name:plan.name,monthlyCents:plan.monthlyCents,setupCents:plan.setupCents},addon:definition.eligibility.businessAddon??null,
        example:examples[id]??`Preview ${definition.name.toLowerCase()} using approved business details.`,
        expectedImprovement:definition.group==='appointments'?'Reduce scheduling back-and-forth while keeping availability verified.':definition.group==='front_desk'?'Help route routine questions and inquiries consistently.':definition.group==='sales'?'Make inquiry handoffs and next steps easier to track.':definition.group==='setup'?'Resolve setup gaps before enabling customer-facing work.':'Reduce repeated preparation and review work.'};
    })};
}
