export type IndustryPackage = {
  name: string;
  plainSummary: string;
  price: string;
  cadence: string;
  bestFor: string;
  customerCan: string[];
  ownerGets: string[];
  technicalDetails: string[];
  support: string;
  featured?: boolean;
};

export type IndustryOffer = {
  id: string;
  name: string;
  shortName: string;
  examples: string[];
  description: string;
  outcomes: string[];
  heroImage: string;
  example: string;
  demoSteps: [string, string, string, string];
  complianceNote?: string;
  packages: IndustryPackage[];
};

type OfferConfig = Omit<IndustryOffer, "heroImage" | "packages"> & {
  levelOne: Omit<IndustryPackage, "featured" | "technicalDetails" | "support">;
  levelTwoPrice: string;
  levelTwoCadence: string;
  levelTwoBestFor: string;
  levelTwoCustomer: [string, string, string];
  levelTwoOwner: [string, string, string];
  levelThreePrice: string;
  levelThreeCadence: string;
  levelThreeBestFor: string;
};

const unique = (items: string[]) => [...new Set(items)];

const buildOffer = (config: OfferConfig): IndustryOffer => ({
  ...config,
  heroImage: `/assets/industries/${config.id}.webp`,
  packages: [
    {
      ...config.levelOne,
      plainSummary: `${config.levelOne.plainSummary} Customers can create an account, save their details, and return without starting over.`,
      customerCan: unique([
        ...config.levelOne.customerCan,
        "Create a secure account and sign in on any phone",
        "Save contact details and return without filling everything out again",
        "Install your branded customer app from the browser—no app store needed",
      ]),
      ownerGets: unique([
        ...config.levelOne.ownerGets,
        "A photo-rich branded website and installable customer app",
        "A private customer and subscriber list you control",
        "Customer accounts, consent records, and an owner dashboard",
      ]),
      technicalDetails: [
        "Progressive Web App (PWA): opens as a website and installs like an app",
        "Secure customer login and account area",
        "Private customer database with contact and marketing-consent records",
        "Managed hosting, backups, security updates, and performance checks",
      ],
      support: "Standard maintenance, hosting, backups, and support-ticket access are included while the monthly plan is active.",
    },
    {
      name: "AI Texting + Follow-Up",
      plainSummary: `Everything in ${config.levelOne.name}, plus two-way text messages and an AI helper that answers approved questions, collects useful details, and keeps follow-up moving.`,
      price: config.levelTwoPrice,
      cadence: config.levelTwoCadence,
      bestFor: config.levelTwoBestFor,
      customerCan: unique([...config.levelTwoCustomer, "Continue a conversation by text without calling again"]),
      ownerGets: unique([...config.levelTwoOwner, "Consent-aware texting, email follow-up, and customer activity history", "Monthly maintenance and workflow checks"]),
      technicalDetails: [
        "AI website assistant trained on your approved services, prices, policies, and hours",
        "Two-way SMS and email automation with opt-out handling",
        "Booking, request, reminder, and win-back rules connected to the customer record",
        "Owner dashboard showing conversations, follow-up, and customers needing attention",
      ],
      support: "Everything in Level 1 support, plus monthly automation checks and faster handling of support tickets.",
      featured: true,
    },
    {
      name: "AI Front Desk + Social Content",
      plainSummary: "Everything above, plus an AI phone assistant and a managed Instagram and TikTok content workflow.",
      price: config.levelThreePrice,
      cadence: config.levelThreeCadence,
      bestFor: config.levelThreeBestFor,
      customerCan: [
        "Call after hours and get answers to common questions",
        "Book, request, confirm, or change the next step by phone or text",
        "Receive clear confirmations and reminders by text or email",
      ],
      ownerGets: [
        "A custom AI voice assistant that answers and routes calls",
        "Scheduling, text-message, and email follow-up in one system",
        "Instagram and TikTok auto-posting with AI-assisted videos and reels",
        "A review option before social posts are published",
        "Priority maintenance, monitoring, and a monthly improvement request",
      ],
      technicalDetails: [
        "AI phone assistant with approved scripts, call routing, and human handoff",
        "Shared scheduling, text, email, and call history",
        "Instagram and TikTok publishing workflow with account-permission checks",
        "AI-assisted short video and reel production with approval controls",
        "Priority monitoring for the customer app and automations",
      ],
      support: "Priority support, monitoring, monthly maintenance, and one scoped improvement request each month are included.",
    },
  ],
});

// Prices are starting prices for the listed scope. SMS, call minutes, AI usage,
// third-party subscriptions, ad spend, regulated-data work, migrations, and
// custom integrations are confirmed before work starts.
export const industryOffers: IndustryOffer[] = [
  buildOffer({
    id: "barbershops-salons",
    name: "Barbershops, hair salons and beauty professionals",
    shortName: "Barbershops & salons",
    examples: ["barber", "barbershop", "hair salon", "stylist", "nail salon", "lash artist", "beauty professional"],
    description: "Let customers see your work, book you directly, and get reminders without sending them to a marketplace full of competitors.",
    outcomes: ["Direct online booking", "Fewer missed appointments", "Your own customer list"],
    example: "A regular scans your chair QR code, books an open time, gets a confirmation, and later receives one useful reminder—without calling or searching a marketplace.",
    demoSteps: ["Scan your QR code", "Choose a service and time", "Get a text or email", "Return from one reminder"],
    levelOne: {
      name: "Website + Booking",
      plainSummary: "A branded website customers can save to their phone like an app, with scheduling and email confirmations.",
      price: "$495 setup",
      cadence: "+ $25 per month",
      bestFor: "A solo barber, stylist, or beauty professional who wants direct bookings.",
      customerCan: ["See services, prices, and haircut photos", "Book an open time from any phone", "Get an email confirmation and reminder"],
      ownerGets: ["Your name and brand on the site", "A chair QR code and booking link", "Your own calendar and customer list"],
    },
    levelTwoPrice: "$995 setup",
    levelTwoCadence: "+ $149 per month",
    levelTwoBestFor: "A busy chair or shop that wants fewer no-shows and faster customer replies.",
    levelTwoCustomer: ["Get appointment texts and one-tap rescheduling", "Ask common questions through the AI website helper", "Receive a reminder when it is time to book again"],
    levelTwoOwner: ["Automatic appointment and win-back texts", "An AI helper for prices, hours, and booking questions", "A daily schedule and list of customers who have not returned"],
    levelThreePrice: "$2,495 setup",
    levelThreeCadence: "+ $399 per month",
    levelThreeBestFor: "A shop that wants calls, bookings, follow-up, and social content handled as one system.",
  }),
  buildOffer({
    id: "clinics-dentists",
    name: "Clinics, dentists and healthcare practices",
    shortName: "Clinics & dentists",
    examples: ["clinic", "doctor", "dentist", "dental office", "therapist", "chiropractor", "physical therapy", "medical practice"],
    description: "Help patients find the right service and request an appointment without asking them to put private medical details in a public form.",
    outcomes: ["Clear appointment requests", "Less phone tag", "Safer public forms"],
    example: "A patient selects a service, shares only contact and scheduling details, and gets a clear confirmation while staff see who owns the request.",
    demoSteps: ["Choose a service", "Request a time", "Get a clear confirmation", "Staff follows one queue"],
    complianceNote: "Public forms and AI answer only non-clinical questions and collect minimum scheduling details. Health information and medical-system connections require a separate privacy and compliance review.",
    levelOne: {
      name: "Website + Appointment Requests",
      plainSummary: "A clear mobile website with services, minimum-data appointment requests, and confirmation emails.",
      price: "$1,500 setup",
      cadence: "+ $79 per month",
      bestFor: "A small practice with confusing pages or too many appointment calls.",
      customerCan: ["Choose the right service", "Request a preferred day and time", "Get an email confirming the request was received"],
      ownerGets: ["Plain-language service pages", "A minimum-data appointment form", "Staff email alerts and a request list"],
    },
    levelTwoPrice: "$2,500 setup",
    levelTwoCadence: "+ $249 per month",
    levelTwoBestFor: "A practice that spends too much time answering routine scheduling questions.",
    levelTwoCustomer: ["Get approved appointment texts", "Ask non-clinical questions through the AI helper", "Confirm or request a schedule change"],
    levelTwoOwner: ["Approved reminder and follow-up messages", "A non-clinical AI website helper", "Clear staff ownership for every request"],
    levelThreePrice: "$6,500 setup",
    levelThreeCadence: "+ $699 per month",
    levelThreeBestFor: "An established practice ready for a reviewed, non-clinical phone and follow-up workflow.",
  }),
  buildOffer({
    id: "real-estate",
    name: "Real estate agents, brokers and property teams",
    shortName: "Real estate",
    examples: ["real estate agent", "realtor", "broker", "property manager", "leasing agent", "real estate team"],
    description: "Turn listing views, open-house visitors, and referrals into organized follow-up you control.",
    outcomes: ["Direct lead capture", "Faster follow-up", "Organized listing inquiries"],
    example: "An open-house visitor scans the property QR code, asks about that exact listing, and the lead reaches the right agent with the source attached.",
    demoSteps: ["Scan a listing QR code", "Ask about that property", "Get an instant reply", "Book the showing"],
    levelOne: {
      name: "Website + Lead Capture",
      plainSummary: "A personal website with listings, service areas, showing requests, and email alerts.",
      price: "$750 setup",
      cadence: "+ $39 per month",
      bestFor: "An individual agent who needs a professional home for referrals.",
      customerCan: ["See who you help and where", "View featured listings", "Request a call or showing"],
      ownerGets: ["A branded mobile website", "A lead form and calendar link", "Instant email alerts for new inquiries"],
    },
    levelTwoPrice: "$1,500 setup",
    levelTwoCadence: "+ $149 per month",
    levelTwoBestFor: "An agent running listings and open houses who needs every lead answered quickly.",
    levelTwoCustomer: ["Get a fast text about the exact property", "Ask common listing questions through AI", "Book a showing from one link"],
    levelTwoOwner: ["Automatic first-response texts", "An AI helper trained on approved listing details", "Property, source, and follow-up tracking"],
    levelThreePrice: "$4,500 setup",
    levelThreeCadence: "+ $499 per month",
    levelThreeBestFor: "An agent or team that wants 24/7 lead response plus consistent listing content.",
  }),
  buildOffer({
    id: "restaurants-cafes",
    name: "Restaurants, cafés, bakeries and caterers",
    shortName: "Restaurants & cafés",
    examples: ["restaurant", "cafe", "coffee shop", "bakery", "caterer", "food truck", "private dining"],
    description: "Put the menu, directions, ordering, reservations, and event inquiries where guests can find them in seconds.",
    outcomes: ["Easy menu and directions", "More event inquiries", "Repeat-guest offers"],
    example: "A guest finds the menu, reserves or orders in one tap, then sends a private-event request that reaches the right person instead of a forgotten inbox.",
    demoSteps: ["Open the menu", "Order or reserve", "Get a confirmation", "Return for an offer"],
    levelOne: {
      name: "Website + Orders & Reservations",
      plainSummary: "A fast mobile website with your menu, hours, map, ordering, reservations, and inquiry emails.",
      price: "$650 setup",
      cadence: "+ $29 per month",
      bestFor: "A local restaurant whose menu or basic information is hard to find.",
      customerCan: ["Read the menu on a phone", "Get directions or call in one tap", "Order, reserve, or ask about an event"],
      ownerGets: ["Easy menu updates", "Links to your ordering and reservation tools", "Email alerts for catering or event inquiries"],
    },
    levelTwoPrice: "$1,250 setup",
    levelTwoCadence: "+ $149 per month",
    levelTwoBestFor: "A restaurant that wants faster guest replies and more repeat visits.",
    levelTwoCustomer: ["Get reservation or event follow-up by text", "Ask AI about hours, menu basics, or directions", "Join offers by choice"],
    levelTwoOwner: ["Automatic guest and event follow-up", "An AI helper for approved menu and business questions", "A guest and inquiry list you control"],
    levelThreePrice: "$3,500 setup",
    levelThreeCadence: "+ $499 per month",
    levelThreeBestFor: "A busy restaurant that wants calls, guest follow-up, and social content handled consistently.",
  }),
  buildOffer({
    id: "spas-fitness",
    name: "Spas, massage, gyms and fitness studios",
    shortName: "Spas & fitness",
    examples: ["spa", "med spa", "massage", "gym", "fitness studio", "yoga", "pilates", "personal trainer"],
    description: "Make services, classes, packages, and booking simple from a phone—and make return visits easier.",
    outcomes: ["Easy service booking", "Fewer no-shows", "More renewals"],
    example: "A client compares services, books from a phone, gets a reminder, and receives a package-renewal prompt only when it is relevant.",
    demoSteps: ["Choose a service", "Book a time", "Get a reminder", "Renew or rebook"],
    levelOne: {
      name: "Website + Booking",
      plainSummary: "A website customers can save to their phone like an app, with services, classes, scheduling, and emails.",
      price: "$650 setup",
      cadence: "+ $39 per month",
      bestFor: "A solo provider or studio that needs a calmer booking experience.",
      customerCan: ["Compare services or classes", "Book from any phone", "Get a confirmation email"],
      ownerGets: ["A branded mobile website", "Booking and calendar setup", "A customer and appointment list"],
    },
    levelTwoPrice: "$1,350 setup",
    levelTwoCadence: "+ $169 per month",
    levelTwoBestFor: "A studio that wants fewer no-shows and faster answers to routine questions.",
    levelTwoCustomer: ["Get reminder and reschedule texts", "Ask AI about approved services, classes, and hours", "Receive a renewal reminder"],
    levelTwoOwner: ["Automatic reminders and renewal texts", "An AI helper for approved service questions", "Rebooking lists and simple monthly reporting"],
    levelThreePrice: "$3,995 setup",
    levelThreeCadence: "+ $499 per month",
    levelThreeBestFor: "A growing studio that wants phone coverage, booking follow-up, and social content in one system.",
  }),
  buildOffer({
    id: "home-services",
    name: "Home-service companies and contractors",
    shortName: "Home services",
    examples: ["plumber", "electrician", "HVAC", "cleaner", "landscaper", "roofer", "contractor", "handyman", "pest control"],
    description: "Capture calls and quote requests while you are on a job, then keep estimates and follow-up from getting lost.",
    outcomes: ["Fewer missed leads", "Better quote requests", "Faster owner alerts"],
    example: "A homeowner calls while the owner is on a job, receives a quick reply, sends the needed details, and enters an organized estimate follow-up list.",
    demoSteps: ["Request a quote", "Share job details", "Get a fast reply", "Book the visit"],
    levelOne: {
      name: "Website + Quote Requests",
      plainSummary: "A mobile website with services, coverage areas, quote requests, and email alerts.",
      price: "$750 setup",
      cadence: "+ $79 per month",
      bestFor: "An owner-operator who misses calls while working on-site.",
      customerCan: ["See whether you cover their area", "Describe the job and request a quote", "Get confirmation that the request arrived"],
      ownerGets: ["Service and area pages", "A clear quote-request form", "Instant lead alerts by email"],
    },
    levelTwoPrice: "$1,750 setup",
    levelTwoCadence: "+ $199 per month",
    levelTwoBestFor: "A company losing jobs between the first call and an approved estimate.",
    levelTwoCustomer: ["Get a fast missed-call text", "Ask AI about approved services and coverage areas", "Choose the next available step"],
    levelTwoOwner: ["Automatic first-response texts", "An AI helper that gathers useful lead details", "Estimate and follow-up reminders"],
    levelThreePrice: "$5,500 setup",
    levelThreeCadence: "+ $599 per month",
    levelThreeBestFor: "A growing contractor that needs calls, scheduling, follow-up, and local content handled reliably.",
  }),
  buildOffer({
    id: "professional-services",
    name: "Law firms, accountants, agencies and consultants",
    shortName: "Professional services",
    examples: ["lawyer", "law firm", "accountant", "CPA", "insurance agency", "consultant", "marketing agency", "architect"],
    description: "Explain your value clearly, collect the right consultation details, and follow up without inbox chaos.",
    outcomes: ["Clear service pages", "Better consultation requests", "Organized follow-up"],
    example: "A prospective client understands the firm's fit, requests a consultation with the right context, and receives a clear next step without repeated email chasing.",
    demoSteps: ["Understand your services", "Request a consultation", "Get the next step", "Book the meeting"],
    complianceNote: "AI answers only approved general questions. Legal, financial, insurance, and other professional advice always stays with a qualified person.",
    levelOne: {
      name: "Website + Consultation Requests",
      plainSummary: "A clear website with service pages, consultation requests, and email alerts.",
      price: "$1,250 setup",
      cadence: "+ $49 per month",
      bestFor: "An expert or small firm whose website does not explain why clients should call.",
      customerCan: ["Understand your services", "See who you are a fit for", "Request a consultation"],
      ownerGets: ["Plain-language service pages", "A consultation form", "Analytics and email alerts"],
    },
    levelTwoPrice: "$2,500 setup",
    levelTwoCadence: "+ $199 per month",
    levelTwoBestFor: "A firm that needs consistent intake and follow-up from inquiry to meeting.",
    levelTwoCustomer: ["Get a prompt text after asking for help", "Ask AI approved general service questions", "Book the next conversation"],
    levelTwoOwner: ["Lead qualification and routing", "An AI helper using approved answers", "Follow-up messages and a simple pipeline"],
    levelThreePrice: "$5,500 setup",
    levelThreeCadence: "+ $599 per month",
    levelThreeBestFor: "A firm that wants routine calls, consultation scheduling, follow-up, and content coordinated.",
  }),
  buildOffer({
    id: "auto-services",
    name: "Auto repair shops, detailers and mobile mechanics",
    shortName: "Auto services",
    examples: ["auto repair", "mechanic", "body shop", "car detailer", "mobile mechanic", "tire shop"],
    description: "Turn calls, vehicle details, photos, and estimate requests into a clear service process.",
    outcomes: ["Clear service requests", "Estimate follow-up", "Maintenance reminders"],
    example: "A driver describes the vehicle and issue, sends useful photos, and receives the next step while the shop keeps the request and estimate history together.",
    demoSteps: ["Describe the vehicle", "Send the problem", "Get the next step", "Approve or schedule"],
    levelOne: {
      name: "Website + Service Requests",
      plainSummary: "A mobile website with services, directions, service requests, and confirmation emails.",
      price: "$750 setup",
      cadence: "+ $39 per month",
      bestFor: "An independent shop that needs a clearer way to request service.",
      customerCan: ["See services and shop information", "Describe the car and problem", "Request an appointment or estimate"],
      ownerGets: ["A branded shop website", "A vehicle and service request form", "Email alerts for new requests"],
    },
    levelTwoPrice: "$1,750 setup",
    levelTwoCadence: "+ $179 per month",
    levelTwoBestFor: "A shop losing work after the first call or estimate.",
    levelTwoCustomer: ["Get a quick text after a missed call", "Ask AI about approved services and hours", "Receive estimate and maintenance follow-up"],
    levelTwoOwner: ["Automatic first responses", "An AI helper for common shop questions", "Estimate and returning-customer reminders"],
    levelThreePrice: "$5,500 setup",
    levelThreeCadence: "+ $599 per month",
    levelThreeBestFor: "A busy shop that wants phone coverage, service follow-up, and social proof running together.",
  }),
  buildOffer({
    id: "pet-care",
    name: "Pet groomers, daycares, boarders and veterinarians",
    shortName: "Pet care",
    examples: ["pet groomer", "dog groomer", "pet daycare", "dog boarding", "veterinarian", "vet", "dog walker"],
    description: "Make booking, basic pet details, reminders, and repeat care easier for busy owners.",
    outcomes: ["Easy online booking", "Clear pet intake", "Repeat-care reminders"],
    example: "A pet owner chooses the service, provides basic pet details, books a time, and gets a reminder when the next grooming or care visit is due.",
    demoSteps: ["Choose pet care", "Share basic details", "Book a time", "Return on schedule"],
    levelOne: {
      name: "Website + Booking",
      plainSummary: "A website customers can save to their phone like an app, with services, booking, and emails.",
      price: "$650 setup",
      cadence: "+ $39 per month",
      bestFor: "A groomer, walker, or small local pet-care business.",
      customerCan: ["See services and policies", "Request or book a time", "Get a confirmation email"],
      ownerGets: ["A branded mobile website", "Basic pet and booking intake", "A customer and appointment list"],
    },
    levelTwoPrice: "$1,350 setup",
    levelTwoCadence: "+ $149 per month",
    levelTwoBestFor: "A team that wants fewer no-shows and faster answers for pet owners.",
    levelTwoCustomer: ["Get reminder and rebooking texts", "Ask AI about approved services and policies", "Change a booking from one link"],
    levelTwoOwner: ["Automatic reminders", "An AI helper for approved routine questions", "A repeat-care and rebooking list"],
    levelThreePrice: "$3,995 setup",
    levelThreeCadence: "+ $499 per month",
    levelThreeBestFor: "A busy pet-care team that wants phone coverage, booking follow-up, and social content together.",
  }),
  buildOffer({
    id: "retail",
    name: "Retail shops, boutiques and specialty stores",
    shortName: "Retail stores",
    examples: ["retail store", "boutique", "gift shop", "specialty store", "jewelry store", "clothing store", "florist"],
    description: "Help nearby shoppers find you, see what is special, hear about events or product drops, and return.",
    outcomes: ["Better local discovery", "Event and pickup requests", "Customer offer list"],
    example: "A nearby shopper sees featured products, checks hours, asks about pickup, and chooses to join the store's own list for the next event or product drop.",
    demoSteps: ["Find a product", "Ask about pickup", "Get a quick reply", "Return for a drop"],
    levelOne: {
      name: "Website + Customer Requests",
      plainSummary: "A fast mobile website with products, hours, directions, pickup or event requests, and emails.",
      price: "$750 setup",
      cadence: "+ $39 per month",
      bestFor: "An independent store that needs a stronger online first impression.",
      customerCan: ["See featured products", "Find hours and directions", "Ask about pickup, stock, or an event"],
      ownerGets: ["A branded mobile website", "Simple product and event updates", "Email alerts for customer requests"],
    },
    levelTwoPrice: "$1,500 setup",
    levelTwoCadence: "+ $169 per month",
    levelTwoBestFor: "A store that wants faster shopper replies and more repeat visits.",
    levelTwoCustomer: ["Get a quick text about a request", "Ask AI about approved hours, products, and events", "Join product-drop or event updates by choice"],
    levelTwoOwner: ["Automatic customer follow-up", "An AI helper for approved store questions", "A customer and campaign list you control"],
    levelThreePrice: "$4,500 setup",
    levelThreeCadence: "+ $499 per month",
    levelThreeBestFor: "A store that wants phone coverage plus consistent Instagram and TikTok content.",
  }),
];

export const findIndustryOffer = (value?: string | null) => {
  if (!value) return undefined;
  const needle = decodeURIComponent(value).trim().toLowerCase();
  return industryOffers.find((industry) =>
    [industry.id, industry.name, industry.shortName, ...industry.examples].some(
      (candidate) => candidate.toLowerCase() === needle,
    ),
  );
};
