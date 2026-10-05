import type { IndustryOffer } from "@/data/industry-offers";
type IndustryAgentContext = {
  customers: string;
  schedule: string;
  requests: string;
  sources: string;
  content: string;
  records: string;
  followUp: string;
};

const contexts: Record<string, IndustryAgentContext> = {
  "barbershops-salons": {
    customers: "clients",
    schedule: "chairs and appointments",
    requests: "booking questions",
    sources: "calls, website bookings, Instagram DMs, and texts",
    content: "finished cuts, transformations, open chairs, and seasonal styles",
    records: "services, preferred barber, visit history, and consent",
    followUp: "no-shows, rebooking, and three-week win-back",
  },
  "clinics-dentists": {
    customers: "patients",
    schedule: "approved appointment requests",
    requests: "non-clinical scheduling questions",
    sources: "calls, website requests, and approved inboxes",
    content:
      "services, office updates, preventive-care education, and staff-approved FAQs",
    records: "minimum contact, scheduling, and consent details",
    followUp: "confirmations, approved reminders, and staff handoff",
  },
  "real-estate": {
    customers: "buyers, sellers, and renters",
    schedule: "showings, calls, and open houses",
    requests: "property and service-area questions",
    sources:
      "listing pages, open-house QR codes, portals, calls, and social messages",
    content:
      "new listings, neighborhood briefs, price changes, and open houses",
    records: "property interest, lead source, timeline, and agent ownership",
    followUp: "new-lead response, showing reminders, and long-cycle nurture",
  },
  "restaurants-cafes": {
    customers: "guests",
    schedule: "reservations, catering calls, and private events",
    requests: "menu, hours, reservation, and event questions",
    sources:
      "calls, website forms, reviews, social comments, and ordering links",
    content: "menu items, chef features, events, slow-day offers, and catering",
    records: "guest opt-ins, event inquiries, preferences, and response status",
    followUp: "event inquiries, review requests, and opt-in return offers",
  },
  "spas-fitness": {
    customers: "members and clients",
    schedule: "services, classes, rooms, and trainers",
    requests: "service, class, package, and policy questions",
    sources: "calls, booking forms, social messages, and front-desk notes",
    content:
      "services, classes, trainer tips, availability, and package reminders",
    records: "bookings, packages, preferences, and consent",
    followUp: "no-shows, rebooking, package renewal, and inactive members",
  },
  "home-services": {
    customers: "homeowners and property managers",
    schedule: "estimates, service windows, and technicians",
    requests: "job, coverage-area, and estimate questions",
    sources: "missed calls, quote forms, photos, Google leads, and email",
    content:
      "before-and-after work, seasonal advice, service areas, and emergency availability",
    records:
      "property, job type, photos, estimate stage, and technician ownership",
    followUp:
      "missed calls, estimate approval, appointment updates, and maintenance reminders",
  },
  "professional-services": {
    customers: "prospective and existing clients",
    schedule: "consultations, deadlines, and follow-up meetings",
    requests: "approved general service and intake questions",
    sources: "referrals, forms, email, calls, and professional networks",
    content:
      "service explainers, deadline reminders, firm updates, and educational posts",
    records: "matter type, fit, owner, deadline, and communication consent",
    followUp:
      "consultation requests, document reminders, proposals, and dormant leads",
  },
  "auto-services": {
    customers: "drivers and fleet contacts",
    schedule: "service requests, estimates, bays, and pickup times",
    requests: "service, estimate, status, and maintenance questions",
    sources: "calls, website requests, photos, reviews, and text messages",
    content:
      "repairs, detailing results, maintenance tips, shop updates, and seasonal offers",
    records: "vehicle, concern, photos, estimate status, and service history",
    followUp:
      "missed calls, estimate approval, status updates, and future maintenance",
  },
  "pet-care": {
    customers: "pet owners",
    schedule: "grooming, daycare, boarding, walks, and approved appointments",
    requests: "service, policy, availability, and preparation questions",
    sources: "calls, booking forms, social messages, and front-desk notes",
    content:
      "pet transformations, care tips, available slots, events, and repeat-care reminders",
    records: "owner contact, basic pet details, service history, and consent",
    followUp:
      "booking confirmations, rebooking, repeat care, and capacity updates",
  },
  retail: {
    customers: "shoppers",
    schedule: "pickup, events, appointments, and product drops",
    requests: "hours, stock, pickup, event, and product questions",
    sources: "website requests, calls, social comments, DMs, and QR signups",
    content:
      "new products, staff picks, events, behind-the-scenes clips, and local offers",
    records:
      "interests, request history, opt-ins, and purchase-related follow-up",
    followUp:
      "pickup requests, product interest, events, drops, and opted-in offers",
  },
};

const defaultContext: IndustryAgentContext = {
  customers: "customers",
  schedule: "appointments and work",
  requests: "common customer questions",
  sources: "calls, website forms, email, text, and social messages",
  content: "services, customer education, availability, and offers",
  records: "contact details, requests, status, and consent",
  followUp: "new requests, reminders, and repeat business",
};

export function getAgentUseCases(industry: IndustryOffer) {
  const c = contexts[industry.id] ?? defaultContext;
  return [
    {
      title: `Respond to ${c.requests}`,
      example: `Draft answers using approved knowledge from ${c.sources}; collect details and route exceptions to staff.`,
      benefit: "A clear next step for each request.",
    },
    {
      title: `Coordinate ${c.schedule}`,
      example:
        "Connect approved scheduling tools. Confirm availability and policies before making changes.",
      benefit: "Less manual coordination, with people in control.",
    },
    {
      title: "Organize follow-up",
      example: `Prepare ${c.followUp} from permitted ${c.records}. Track ownership and respect communication preferences.`,
      benefit: "One shared view of what needs attention.",
    },
  ];
}
export function getExtendedUseCases(industry?: IndustryOffer) {
  const c = contexts[industry?.id || ""] ?? defaultContext;
  return [
    {
      title: "Owner commands and briefings",
      detail: `Ask what needs attention across ${c.schedule}, open requests and follow-up. A proposed assistant can prepare a briefing from the information you permit, with source links and a handoff for exceptions.`,
    },
    {
      title: "Knowledge and document help",
      detail: `Find approved answers for ${c.requests}. Retrieve permitted documents, show the source and flag missing or conflicting information instead of inventing a policy.`,
    },
    {
      title: "Content preparation",
      detail: `Prepare drafts around ${c.content}. Your team checks accuracy, rights and consent before publishing; platform access and publishing permissions must be verified.`,
    },
    {
      title: "Reporting and a shared customer view",
      detail: `Organize permitted ${c.records} and summarize the agreed operational measures. Reporting depends on reliable source data; illustrative previews are not measured results.`,
    },
    {
      title: "Approval, handoff and support",
      detail:
        "Make proposed actions and approval state visible. Sending, changing bookings and publishing follow agreed review rules, with error handling and a manual fallback. Installation and ongoing support are scoped separately.",
    },
  ];
}
