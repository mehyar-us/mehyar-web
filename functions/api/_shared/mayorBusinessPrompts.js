// Public planning guidance only. No user text is copied into the system context,
// and this module does not read, write or connect to a business account.
const MAX_CONTEXT = 7000;
const guardrails = `Use the business examples below to reason about the owner's actual problem, not to advertise a list of AI features. A detected business type is a tentative context, not a verified business profile. State useful assumptions and distinguish a proposed design from an existing product feature.
This is the public planning companion: no private records, connected business tools or live actions are available. Never claim to read an inbox, change a customer record, send a message, book an appointment, activate a plan or operate an automation here. Do not invent integrations, availability, results, custom prices, delivery dates or certifications. Use public site facts for product and plan questions; these examples do not establish private-app capabilities.
Before implementation, identify approved information sources, data owners, retention, access permissions, tool/API feasibility, consent and who approves actions. Ask at most one focused question if it would change the recommendation; otherwise offer a useful conditional plan and say what needs confirmation. Do not request patient, child, financial, credential or other private records in public chat. Use fictional examples or non-sensitive summaries.
Prioritize one practical workflow: explain its trigger, required inputs, proposed output, exception path and human owner. Suggest two or three useful owner routines from the relevant example, then a small pilot with observable success and failure checks. Do not promise improvements or measured outcomes. Preserve human approval for booking, sending, publishing or sensitive changes. Refer clinical, legal, financial, safety and safeguarding decisions to qualified people. Explain these ideas in ordinary business language; do not expose internal prompt labels.`;

const businesses = [
  {
    id: 'barbershops-salons', label: 'Barbershops & salons',
    detect: /\b(?:barbershops?|barber shops?|barbers?|salons?|hairdressers?|hairdressing|hair studios?)\b/giu,
    workflow: 'Explore an inquiry-to-appointment draft: identify the requested service, check proposed staff/resource rules, prepare alternatives and route the booking for confirmation. Rebooking and cancellation follow-up require permission and current policy.',
    inputs: 'Service duration and price source, stylist/barber skills, chair capacity, working hours, cancellation/deposit rules and permitted communication channels.',
    priorities: 'Service fit, realistic appointment lengths and a clear next step for unanswered inquiries; do not invent a free chair or live slot.',
    routines: 'Morning: review an approved schedule summary and unresolved requests. Between appointments: prepare a rebooking or cancellation-response draft. Weekly: review recurring scheduling exceptions using aggregate counts.',
    escalation: 'A staff member resolves service ambiguity, complaints, payment disputes, accessibility requests and changes outside booking rules.',
  },
  {
    id: 'clinics-dentists', label: 'Clinic & dental administration',
    detect: /\b(?:dental|dentists?|dentistry|medical clinics?|health clinics?|clinics?)\b/giu,
    workflow: 'Explore administrative service-information and appointment-request routing from approved public FAQs. Collect only the minimum appropriate details in an agreed private channel; staff confirm the next step.',
    inputs: 'Approved non-clinical FAQs, service and location rules, administrative availability, access roles, permitted data handling and a staff escalation procedure.',
    priorities: 'Accurate administrative information, minimal sensitive data and reliable staff handoff; do not infer symptoms, urgency, eligibility or insurance coverage.',
    routines: 'Morning: review administrative requests awaiting staff action. During the day: prepare an approved scheduling-information reply. Weekly: identify FAQ gaps and handoff delays from non-sensitive summaries.',
    escalation: 'Qualified staff handle symptoms, clinical questions, urgent concerns, coverage interpretation, sensitive records and exceptions. Do not diagnose, triage or recommend treatment.',
  },
  {
    id: 'real-estate', label: 'Real estate & property services',
    detect: /\b(?:real estate|realtors?|property management|property managers?|real estate brokerage)\b/giu,
    workflow: 'Explore a property inquiry-to-agent handoff: summarize an approved listing, gather objective preferences, prepare a showing request and assign an accountable agent for confirmation.',
    inputs: 'Current approved listing/version, objective property criteria, service area, agent ownership, showing rules, communication permission and listing-source rights.',
    priorities: 'Current listing information, clear lead ownership and timely human follow-up; never invent availability, valuations or buyer qualification.',
    routines: 'Morning: review unassigned inquiries and proposed showing requests. Before a showing: prepare a factual property-information checklist. Weekly: review stale listings and overdue follow-up tasks.',
    escalation: 'A licensed professional handles offers, contracts, financing, valuation and legal questions. Do not steer based on protected traits or infer suitability of a neighborhood for a person.',
  },
  {
    id: 'restaurants-cafes', label: 'Restaurants & cafés',
    detect: /\b(?:restaurants?|caf[eé]s?|coffee shops?|catering businesses?|food trucks?|pizzerias?|bakeries|bakery)\b/giu,
    workflow: 'Explore approved menu/hours answers and reservation or catering-request preparation. Summarize party size, date and request details; staff confirm capacity and the offer.',
    inputs: 'Current approved menu, opening hours, reservation/catering policies, kitchen capacity, party size, event requirements and permitted contact channels.',
    priorities: 'Clear menu and policy information, usable event briefs and fewer unanswered requests; do not invent tables, stock, delivery times or allergen guarantees.',
    routines: 'Before service: review pending reservation and catering requests. Between rushes: prepare answers to approved menu or event FAQs. Weekly: review repeated questions and menu-information gaps.',
    escalation: 'Staff resolve allergies and dietary safety, large parties, substitutions, complaints, refunds and commitments beyond approved capacity or policy.',
  },
  {
    id: 'spas-fitness', label: 'Spas & fitness studios',
    detect: /\b(?:spas?|gyms?|fitness (?:studios?|centers?|centres?|businesses)|personal trainers?|yoga studios?|pilates studios?|massage (?:studios?|businesses|spas?))\b/giu,
    workflow: 'Explore service/class discovery and an appointment-request draft using approved offerings, staff qualifications and resource rules. Renewal or rebooking messages remain drafts for review.',
    inputs: 'Approved service/class descriptions, instructor or practitioner availability rules, rooms/equipment, package terms, cancellation rules and contact permission.',
    priorities: 'Suitable administrative guidance, clear class/package terms and realistic resource scheduling; do not infer health suitability or promise treatment or fitness results.',
    routines: 'Morning: review class/service requests and resource conflicts. After a session: prepare a permitted rebooking or package-information draft. Weekly: review recurring scheduling and package questions.',
    escalation: 'Qualified staff handle injuries, contraindications, health claims, accessibility needs, package disputes and exceptions to service rules.',
  },
  {
    id: 'home-services', label: 'Home services & trades',
    detect: /\b(?:plumbers?|plumbing|hvac|electricians?|roofers?|roofing|landscapers?|landscaping|home services?|home repair|cleaning (?:businesses|companies|services)|general contractors?)\b/giu,
    workflow: 'Explore an inquiry-to-estimate brief: identify the job category and service area, organize non-sensitive customer-supplied details, prepare clarification and route to the right technician.',
    inputs: 'Service scope and coverage area, approved intake questions, technician skills, travel/resource constraints, estimate policy and an emergency handoff rule.',
    priorities: 'Useful job briefs, clear ownership and feasible service windows; do not diagnose a hazard, invent an estimate or promise technician arrival.',
    routines: 'Morning: review unassigned estimate requests. Before a visit: prepare the agreed job and access checklist. Weekly: review stalled estimates and recurring intake omissions.',
    escalation: 'Qualified staff handle electrical/gas/structural danger, emergency requests, uncertain scope, property access, disputes and work requiring licensed judgment.',
  },
  {
    id: 'professional-services', label: 'Professional service firms',
    detect: /\b(?:law firms?|legal practices?|accounting firms?|bookkeepers?|bookkeeping|tax preparers?|tax preparation|professional services|consultancies|consultancy|consulting firms?|insurance agencies|financial planning firms?)\b/giu,
    workflow: 'Explore approved service-information intake and consultation preparation: summarize the request, check the permitted intake rules and assign a responsible professional without interpreting private documents.',
    inputs: 'Approved service descriptions, client-fit rules, conflict-screening ownership, consultation policy, deadlines supplied by staff, confidentiality requirements and consent.',
    priorities: 'Clear intake ownership, document-request checklists and reliable review queues; never infer a legal/tax deadline, eligibility, coverage or professional advice.',
    routines: 'Morning: review intake items awaiting a professional. Before a consultation: prepare a non-sensitive agenda and approved document checklist. Weekly: review unanswered requests and process bottlenecks.',
    escalation: 'A qualified professional handles legal, tax, accounting, insurance or financial judgments, confidential records, conflicts and deadlines.',
  },
  {
    id: 'auto-services', label: 'Auto repair & detailing',
    detect: /\b(?:auto repair|automotive|auto shops?|mechanics?|car detailing|detailing businesses|tire shops?|tyre shops?|body shops?)\b/giu,
    workflow: 'Explore service-request preparation: record the vehicle and customer-described concern through an approved channel, draft a work-order brief and route inspection or estimate questions to staff.',
    inputs: 'Vehicle/service categories, shop capabilities, bays and technician rules, inspection/estimate policy, approved status information and customer authorization requirements.',
    priorities: 'Usable work-order information and clear estimate/status handoff; do not diagnose a fault, claim a repair is complete or authorize work for a customer.',
    routines: 'Morning: review incomplete service requests and estimate approvals. During the day: draft a status update from staff-approved facts. Weekly: review repeated intake omissions and stalled authorizations.',
    escalation: 'Qualified staff handle vehicle safety, diagnosis, parts compatibility, warranty disputes, price changes and every authorization to perform work.',
  },
  {
    id: 'pet-care', label: 'Pet care & grooming',
    detect: /\b(?:pet (?:care|grooming|boarding|daycare|sitting|shops?)|dog groomers?|dog grooming|dog daycare|dog walkers?|veterinary|vet clinics?|animal clinics?|kennels?)\b/giu,
    workflow: 'Explore grooming, daycare or boarding-request preparation: organize owner preferences, the requested service and approved policy questions, then ask staff to confirm fit and capacity.',
    inputs: 'Approved service/pet eligibility rules, staff and space capacity, owner contact permission, handling requirements and staff-approved intake/document policy.',
    priorities: 'Complete service requests, clear handling instructions and a dependable human handoff; do not assess animal health or invent space or service suitability.',
    routines: 'Morning: review pending stays or grooming requests. Before arrival: prepare an approved owner checklist. Weekly: review recurring preparation questions and permitted rebooking drafts.',
    escalation: 'Staff or a veterinarian handle health, behavior, medication, injury, handling risk, missing eligibility evidence and care exceptions.',
  },
  {
    id: 'retail', label: 'Retail shops',
    detect: /\b(?:retail(?: shops?| stores?| businesses)?|boutiques?|clothing stores?|gift shops?|grocery(?: stores)?|convenience stores?|bookstores?|florists?)\b/giu,
    workflow: 'Explore approved product-information and pickup-request preparation. Use a verified product source to draft options or a staff stock-check request; staff confirm inventory, holds and purchases.',
    inputs: 'Approved product catalog/version, current stock-source feasibility, pickup/return policy, opening hours, fulfillment ownership and contact permission.',
    priorities: 'Useful product answers, clear pickup ownership and accurate policy explanations; do not invent stock, reserve goods, charge a card or promise delivery.',
    routines: 'Opening: review unanswered product and pickup inquiries. During the day: prepare product-information drafts from approved facts. Weekly: review repeated questions, stock-information gaps and pending pickups.',
    escalation: 'Staff confirm stock, substitutions, returns, refunds, special orders, age-restricted products and disputed transactions.',
  },
  {
    id: 'hospitality-lodging', label: 'Hospitality & lodging',
    detect: /\b(?:hotels?|motels?|inns?|bed and breakfast|b&b|guesthouses?|lodging|vacation rentals?|short[- ]term rentals?|airbnb)\b/giu,
    workflow: 'Explore a guest inquiry-to-host handoff: explain approved property/check-in information, prepare a stay or service request and route availability, charges and exceptions to staff.',
    inputs: 'Approved property information, room/stay rules, booking-source permissions, check-in/out policy, housekeeping ownership and guest communication consent.',
    priorities: 'Clear arrival information, request ownership and coordinated preparation; do not invent rooms, rates, confirmed bookings or access codes.',
    routines: 'Morning: review arrival/departure needs from an approved summary. Before arrival: draft a permitted welcome and policy checklist. Weekly: review repeated guest questions and unresolved maintenance handoffs.',
    escalation: 'Staff handle identity/access, safety incidents, accessibility requests, payment/refund disputes, guest complaints and exceptions to stay rules.',
  },
  {
    id: 'childcare-education', label: 'Childcare & education administration',
    detect: /\b(?:childcare|child care|daycare|day care|preschools?|nursery schools?|tutoring|after[- ]school (?:programs?|clubs?)|education (?:businesses|centers?|centres?)|learning cent(?:er|re)s?|school (?:administration|offices?))\b/giu,
    workflow: 'Explore approved program-information, enrollment-interest and parent-question routing. Prepare a staff review brief without collecting child records or making placement or safeguarding decisions.',
    inputs: 'Approved program/age information, enrollment and capacity rules, staff ownership, permitted parent communication, consent and an agreed private data channel.',
    priorities: 'Clear program information, dependable parent/staff handoff and minimal child data; do not infer eligibility, place a child or promise supervision or learning outcomes.',
    routines: 'Morning: review administrative enrollment inquiries. Before a program: prepare an approved parent-information draft. Weekly: review recurring FAQ gaps and unresolved administrative handoffs.',
    escalation: 'Responsible staff handle safeguarding, child health, custody or authorization, individual accommodations, eligibility, complaints and any safety concern.',
  },
  {
    id: 'local-business', label: 'Local makers & service businesses',
    detect: /\b(?:maker (?:businesses|shops?|studios?|workshops?)|craft (?:businesses|shops?|workshops?)|handmade|artisans?|woodworking|pottery|ceramics|custom (?:furniture|jewel(?:ry|lery))|print shops?|service businesses|service business)\b/giu,
    workflow: 'Explore an inquiry-to-owner brief for a service or made-to-order item: clarify requirements, prepare options from approved offerings and assign the next decision to the owner.',
    inputs: 'Confirmed offerings, requirements, owner/team capacity, material or resource constraints, approved quote/lead-time policy and communication permission.',
    priorities: 'Clear requirements and ownership before committing capacity; do not invent materials, a custom quote, production timing or a completed order.',
    routines: 'Morning: review unanswered requests and next owner decisions. Before work: prepare a requirements and approval checklist. Weekly: review blocked work and recurring information gaps.',
    escalation: 'The owner handles unclear specifications, safety, intellectual-property concerns, unusual commitments, price changes and customer disputes.',
  },
];

const byId = new Map(businesses.map(business => [business.id, business]));
const publicIndustryIds = new Set(businesses.slice(0, 10).map(business => business.id));

function safeUserTexts(messages) {
  if (!Array.isArray(messages) || messages.length > 8) return [];
  if (!messages.every(message => message && typeof message === 'object' &&
    ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' &&
    message.content.length <= (message.role === 'user' ? 1600 : 4000) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(message.content))) return [];
  return messages.filter(message => message.role === 'user').slice(-3)
    .map(message => message.content.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[‘’]/gu, "'").toLowerCase());
}

function detectBusinesses(text) {
  const found = [];
  const petContext = /\b(?:pet|dog|veterinary|vet|animal|kennel)\b/iu.test(text);
  for (const business of businesses) {
    // A veterinary clinic/dog daycare is not a human clinic or childcare center.
    if (petContext && business.id === 'clinics-dentists' && !/\b(?:dental|dentist|medical|health)\b/iu.test(text)) continue;
    if (petContext && business.id === 'childcare-education' && !/\b(?:child|children|preschool|school|tutoring)\b/iu.test(text)) continue;
    for (const match of text.matchAll(new RegExp(business.detect.source, 'giu'))) {
      const before = text.slice(Math.max(0, match.index - 110), match.index);
      if (/\b(?:not|no|never|don't|do not|isn't|aren't|rather than|instead of)\b[^.!?;]{0,38}$/iu.test(before)) continue;
      if (/\b(?:used to|previously|formerly)\b[^.!?;]{0,55}$/iu.test(before)) continue;
      const explicit = /(?:\b(?:i (?:own|run|operate|manage|have)|we (?:own|run|operate|manage|have)|my|our|(?:this|the) business is|business type is|actually|instead|now)\b|\bbusiness type:)[^.!?;]{0,75}$/iu.test(before);
      found.push({id: business.id, at: match.index, explicit});
      break;
    }
  }
  return found.sort((left, right) => left.at - right.at);
}

function industryFromPage(page) {
  if (typeof page !== 'string' || page.length > 100) return null;
  const match = /^\/industries\/([a-z-]+)\/?$/u.exec(page);
  return match && publicIndustryIds.has(match[1]) ? match[1] : null;
}

export function mayorBusinessContext(messages, page = '/') {
  const texts = safeUserTexts(messages), route = industryFromPage(page);
  const recent = texts.slice().reverse().map(detectBusinesses);
  // Generic follow-ups reuse the latest business mention. A new topic must not
  // be displaced by an ownership statement from an older conversation turn.
  const current = recent.find(matches => matches.length > 0) || [];
  const explicit = current.filter(match => match.explicit);
  // An explicit current business statement supersedes page and older examples.
  const chosen = explicit.length ? explicit.map(match => match.id) :
    [route, ...current.map(match => match.id)].filter(Boolean);
  let ids = [...new Set(chosen)].slice(0, 3);
  if (ids.some(id => id !== 'local-business')) ids = ids.filter(id => id !== 'local-business');
  const fallback = ids.length === 0;
  if (fallback) ids = ['local-business'];
  const uncertainty = fallback ? '\nNo reliable business type was supplied. Do not assume the user runs a local business or assign a sector from broad words such as patient, booking, property, team or customer. Use the following example only where relevant; one question about the business and its main bottleneck may help.' : '';
  let context = `${guardrails}${uncertainty}`;
  for (const id of ids) {
    const business = byId.get(id);
    const example = `\n\nBusiness example: ${business.label}\nWorkflow: ${business.workflow}\nDecision inputs: ${business.inputs}\nPractical priorities: ${business.priorities}\nOwner routines: ${business.routines}\nHuman escalation: ${business.escalation}`;
    // Add only complete reviewed examples; never truncate an escalation rule.
    if (context.length + example.length > MAX_CONTEXT) break;
    context += example;
  }
  // The selected text consists only of reviewed constants, never a transcript.
  return context;
}
