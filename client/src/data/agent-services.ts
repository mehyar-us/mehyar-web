import type { IndustryOffer } from "@/data/industry-offers";

export type AgentName = "OpenClaw" | "Hermes Agent" | "Either";

export type AgentUseCase = {
  title: string;
  example: string;
  benefit: string;
  bestAgent: AgentName;
};

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
  "barbershops-salons": { customers: "clients", schedule: "chairs and appointments", requests: "booking questions", sources: "calls, website bookings, Instagram DMs, and texts", content: "finished cuts, transformations, open chairs, and seasonal styles", records: "services, preferred barber, visit history, and consent", followUp: "no-shows, rebooking, and three-week win-back" },
  "clinics-dentists": { customers: "patients", schedule: "approved appointment requests", requests: "non-clinical scheduling questions", sources: "calls, website requests, and approved inboxes", content: "services, office updates, preventive-care education, and staff-approved FAQs", records: "minimum contact, scheduling, and consent details", followUp: "confirmations, approved reminders, and staff handoff" },
  "real-estate": { customers: "buyers, sellers, and renters", schedule: "showings, calls, and open houses", requests: "property and service-area questions", sources: "listing pages, open-house QR codes, portals, calls, and social messages", content: "new listings, neighborhood briefs, price changes, and open houses", records: "property interest, lead source, timeline, and agent ownership", followUp: "new-lead response, showing reminders, and long-cycle nurture" },
  "restaurants-cafes": { customers: "guests", schedule: "reservations, catering calls, and private events", requests: "menu, hours, reservation, and event questions", sources: "calls, website forms, reviews, social comments, and ordering links", content: "menu items, chef features, events, slow-day offers, and catering", records: "guest opt-ins, event inquiries, preferences, and response status", followUp: "event inquiries, review requests, and opt-in return offers" },
  "spas-fitness": { customers: "members and clients", schedule: "services, classes, rooms, and trainers", requests: "service, class, package, and policy questions", sources: "calls, booking forms, social messages, and front-desk notes", content: "services, classes, trainer tips, availability, and package reminders", records: "bookings, packages, preferences, and consent", followUp: "no-shows, rebooking, package renewal, and inactive members" },
  "home-services": { customers: "homeowners and property managers", schedule: "estimates, service windows, and technicians", requests: "job, coverage-area, and estimate questions", sources: "missed calls, quote forms, photos, Google leads, and email", content: "before-and-after work, seasonal advice, service areas, and emergency availability", records: "property, job type, photos, estimate stage, and technician ownership", followUp: "missed calls, estimate approval, appointment updates, and maintenance reminders" },
  "professional-services": { customers: "prospective and existing clients", schedule: "consultations, deadlines, and follow-up meetings", requests: "approved general service and intake questions", sources: "referrals, forms, email, calls, and professional networks", content: "service explainers, deadline reminders, firm updates, and educational posts", records: "matter type, fit, owner, deadline, and communication consent", followUp: "consultation requests, document reminders, proposals, and dormant leads" },
  "auto-services": { customers: "drivers and fleet contacts", schedule: "service requests, estimates, bays, and pickup times", requests: "service, estimate, status, and maintenance questions", sources: "calls, website requests, photos, reviews, and text messages", content: "repairs, detailing results, maintenance tips, shop updates, and seasonal offers", records: "vehicle, concern, photos, estimate status, and service history", followUp: "missed calls, estimate approval, status updates, and future maintenance" },
  "pet-care": { customers: "pet owners", schedule: "grooming, daycare, boarding, walks, and approved appointments", requests: "service, policy, availability, and preparation questions", sources: "calls, booking forms, social messages, and front-desk notes", content: "pet transformations, care tips, available slots, events, and repeat-care reminders", records: "owner contact, basic pet details, service history, and consent", followUp: "booking confirmations, rebooking, repeat care, and capacity updates" },
  retail: { customers: "shoppers", schedule: "pickup, events, appointments, and product drops", requests: "hours, stock, pickup, event, and product questions", sources: "website requests, calls, social comments, DMs, and QR signups", content: "new products, staff picks, events, behind-the-scenes clips, and local offers", records: "interests, request history, opt-ins, and purchase-related follow-up", followUp: "pickup requests, product interest, events, drops, and opted-in offers" },
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

export function getAgentUseCases(industry: IndustryOffer): AgentUseCase[] {
  const c = contexts[industry.id] ?? defaultContext;
  return [
    { title: "Morning owner briefing", example: `Ask from Telegram: “What matters today?” Receive a short brief covering ${c.schedule}, unanswered ${c.requests}, and follow-up due.`, benefit: "Starts the day with priorities instead of checking every inbox.", bestAgent: "Hermes Agent" },
    { title: "Missed-lead rescue", example: `Watch approved ${c.sources}; draft or send the allowed first reply, collect missing details, and place the request in the right queue.`, benefit: "Reduces the time a serious prospect waits for a response.", bestAgent: "OpenClaw" },
    { title: "Inbox and message triage", example: `Summarize new messages from ${c.sources}, group them by urgency, and prepare the next safe action for approval.`, benefit: "Keeps routine questions from hiding valuable requests.", bestAgent: "OpenClaw" },
    { title: "Scheduling coordinator", example: `Check approved availability for ${c.schedule}, offer the next valid step, and send confirmations or change links.`, benefit: "Cuts phone tag and keeps the schedule easier to trust.", bestAgent: "OpenClaw" },
    { title: "Customer record helper", example: `Turn approved conversations into structured ${c.records} without asking staff to copy the same details twice.`, benefit: "Creates a cleaner customer list and more consistent handoffs.", bestAgent: "Either" },
    { title: "Follow-up and win-back", example: `Review ${c.followUp}, prepare the right message, and send only through approved, consent-aware rules.`, benefit: "Creates more chances for repeat business without blasting everyone.", bestAgent: "Hermes Agent" },
    { title: "Reviews and social comments", example: "Summarize reviews, comments, repeated questions, praise, and complaints; draft owner-approved replies and flag anything sensitive.", benefit: "Shows what customers are saying without hours of scrolling.", bestAgent: "Hermes Agent" },
    { title: "Content and reel planner", example: `Build a weekly plan around ${c.content}; draft captions, shot lists, short-video ideas, and an approval queue.`, benefit: "Makes consistent content easier while the owner keeps final control.", bestAgent: "Hermes Agent" },
    { title: "Approved outreach assistant", example: `Build a small, relevant prospect or partner list, research context, draft personalized outreach, and wait for approval before sending.`, benefit: "Supports focused growth work without uncontrolled mass messaging.", bestAgent: "Hermes Agent" },
    { title: "Owner commands from the road", example: "Send a voice note or message from Telegram, WhatsApp, Slack, or another approved channel to request a report, prepare follow-up, or check the next task.", benefit: "Lets the owner direct routine work from a phone while keeping risky actions behind approval.", bestAgent: "OpenClaw" },
  ];
}

export const managedAgentOffers = [
  {
    name: "OpenClaw Business Operator",
    bestFor: "Owners who want one private command channel for messages, routine actions, schedules, and mobile control.",
    image: "/assets/agent-services/mobile-command-assistant.webp",
    managed: "$1,500 setup + $349/month",
    annual: "$1,500 setup + $3,490/year",
    owned: "$3,500 one-time",
    ownedNote: "Runs on infrastructure you provide and includes 12 months of setup support and maintenance guidance.",
    includes: ["Secure OpenClaw gateway installation", "Telegram or another approved messaging channel", "Three business workflows", "Allowlists, approvals, backups, monitoring, and monthly maintenance"],
  },
  {
    name: "Hermes Learning Operator",
    bestFor: "Owners who want recurring research, durable memory, scheduled briefings, and specialist business routines.",
    image: "/assets/agent-services/learning-operations-assistant.webp",
    managed: "$2,500 setup + $549/month",
    annual: "$2,500 setup + $5,490/year",
    owned: "$5,500 one-time",
    ownedNote: "Runs on infrastructure you provide and includes 12 months of setup support and maintenance guidance.",
    includes: ["Hermes Agent installation and secure gateway", "Telegram or another approved messaging channel", "Memory, scheduled reports, and five business skills", "Approvals, isolation, backups, monitoring, and monthly maintenance"],
  },
  {
    name: "AI Operations Team",
    bestFor: "Businesses that want OpenClaw for fast channel control and Hermes for research, memory, and recurring operations.",
    image: "/assets/agent-services/mobile-command-assistant.webp",
    managed: "$4,500 setup + $899/month",
    annual: "$4,500 setup + $8,990/year",
    owned: "$8,500 one-time",
    ownedNote: "Runs on infrastructure you provide and includes 12 months of setup support and maintenance guidance.",
    includes: ["Isolated OpenClaw and Hermes environments", "Up to eight approved business workflows", "Mobile commands, scheduled reports, and human approval gates", "Priority monitoring, backups, maintenance, and one monthly improvement"],
  },
] as const;
