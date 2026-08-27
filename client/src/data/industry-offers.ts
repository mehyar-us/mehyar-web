export type IndustryPackage = {
  name: string;
  plainSummary: string;
  price: string;
  cadence: string;
  bestFor: string;
  customerCan: string[];
  ownerGets: string[];
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
  complianceNote?: string;
  packages: IndustryPackage[];
};

const offer = (
  id: string,
  name: string,
  shortName: string,
  examples: string[],
  description: string,
  outcomes: string[],
  packages: IndustryPackage[],
  example: string,
  complianceNote?: string,
): IndustryOffer => ({
  id,
  name,
  shortName,
  examples,
  description,
  outcomes,
  packages,
  complianceNote,
  heroImage: `/assets/industries/${id}.webp`,
  example,
});

// Each price says exactly what is paid now and what is paid monthly. Usage fees,
// regulated-data work, vendor subscriptions, migrations, and custom integrations
// are quoted before work starts.
export const industryOffers: IndustryOffer[] = [
  offer(
    "barbershops-salons",
    "Barbershops, hair salons and beauty professionals",
    "Barbershops & salons",
    ["barber", "barbershop", "hair salon", "stylist", "nail salon", "lash artist", "beauty professional"],
    "Let customers see your work, book you directly, and get reminders without sending them to a marketplace full of competitors.",
    ["Direct online booking", "Fewer missed appointments", "Your own customer list"],
    [
      {
        name: "Booking Website",
        plainSummary: "A website customers can save to their phone like an app, with scheduling and emails.",
        price: "$495 setup",
        cadence: "+ $25 per month",
        bestFor: "A solo barber, stylist, or beauty professional who wants direct bookings.",
        customerCan: ["See services, prices, and haircut photos", "Book an open time from any phone", "Get an email confirmation and reminder"],
        ownerGets: ["Your name and brand on the site", "A chair QR code and booking link", "Your own booking calendar and customer list"],
      },
      {
        name: "Booking + Text Reminders",
        plainSummary: "Everything in Booking Website, plus reminder texts and easy rescheduling.",
        price: "$995 setup",
        cadence: "+ $79 per month",
        bestFor: "A busy chair or shop that wants fewer no-shows and more repeat visits.",
        customerCan: ["Get a text before the appointment", "Reschedule or cancel from one link", "Receive a reminder when it is time to book again"],
        ownerGets: ["Automatic reminder texts", "A simple daily appointment view", "A list of customers who have not returned"],
        featured: true,
      },
      {
        name: "Booking + Marketing",
        plainSummary: "Everything above, plus help turning finished cuts and open slots into posts and repeat bookings.",
        price: "$1,495 setup",
        cadence: "+ $199 per month",
        bestFor: "A barber or salon that wants a steady social presence without doing every step by hand.",
        customerCan: ["See recent work and open slots", "Move from Instagram to booking in one tap", "Receive occasional offers after opting in"],
        ownerGets: ["A monthly post and reel workflow", "Open-slot promotion templates", "Simple campaign and booking tracking"],
      },
    ],
    "A regular scans the QR code at the chair, picks an open time, gets a confirmation, and later receives one useful reminder instead of calling or searching a marketplace.",
  ),
  offer(
    "clinics-dentists",
    "Clinics, dentists and healthcare practices",
    "Clinics & dentists",
    ["clinic", "doctor", "dentist", "dental office", "therapist", "chiropractor", "physical therapy", "medical practice"],
    "Help patients find the right service and request an appointment without asking them to put private medical details in a public form.",
    ["Clear appointment requests", "Less phone tag", "Safer public forms"],
    [
      {
        name: "Appointment Website",
        plainSummary: "A clear mobile website with services, appointment requests, and confirmation emails.",
        price: "$1,500 setup",
        cadence: "+ $79 per month",
        bestFor: "A small practice with confusing pages or too many appointment calls.",
        customerCan: ["Choose the right service", "Request a preferred day and time", "Get an email confirming the request was received"],
        ownerGets: ["Plain-language service pages", "A minimum-data appointment form", "Staff email alerts and a request list"],
      },
      {
        name: "Appointments + Reminders",
        plainSummary: "Everything in Appointment Website, plus approved reminders and staff follow-up tracking.",
        price: "$2,500 setup",
        cadence: "+ $149 per month",
        bestFor: "A practice that spends too much time chasing confirmations.",
        customerCan: ["Receive appointment reminders", "Confirm or request a change", "Know what happens after submitting"],
        ownerGets: ["Reminder and follow-up workflow", "Clear staff ownership for each request", "Basic request and response reporting"],
        featured: true,
      },
      {
        name: "Practice System Connection",
        plainSummary: "Connect the website and staff workflow to approved practice software after a compliance review.",
        price: "$5,000+",
        cadence: "monthly cost quoted after review",
        bestFor: "An established practice with approved vendors and a defined workflow.",
        customerCan: ["Use one clear request path", "Receive consistent updates", "Avoid repeating basic information"],
        ownerGets: ["A privacy and access plan", "Approved system connections", "Training, testing, and launch support"],
      },
    ],
    "A patient chooses the right service, shares only contact and scheduling details, and gets a clear confirmation while staff see who owns the request.",
    "Public forms collect only basic contact and scheduling details. Patient health information and medical-system connections require a separate privacy and compliance review.",
  ),
  offer(
    "real-estate",
    "Real estate agents, brokers and property teams",
    "Real estate",
    ["real estate agent", "realtor", "broker", "property manager", "leasing agent", "real estate team"],
    "Turn listing views, open-house visitors, and referrals into organized follow-up you control.",
    ["Direct lead capture", "Faster follow-up", "Organized listing inquiries"],
    [
      {
        name: "Agent Website + Lead Form",
        plainSummary: "A personal website with listings, service areas, a contact form, and email alerts.",
        price: "$750 setup",
        cadence: "+ $39 per month",
        bestFor: "An individual agent who needs a professional home for referrals.",
        customerCan: ["See who you help and where", "View featured listings or services", "Request a call or showing"],
        ownerGets: ["A branded mobile website", "A lead form and calendar link", "Instant email alerts for new inquiries"],
      },
      {
        name: "Listings + Automatic Follow-Up",
        plainSummary: "Everything above, plus reusable listing pages, open-house QR codes, and follow-up messages.",
        price: "$1,500 setup",
        cadence: "+ $99 per month",
        bestFor: "An agent running listings and open houses every month.",
        customerCan: ["Scan a sign or open-house QR code", "Ask about one exact property", "Receive a useful follow-up message"],
        ownerGets: ["Reusable listing page templates", "Lead source and property tracking", "Automatic first follow-up"],
        featured: true,
      },
      {
        name: "Team Lead System",
        plainSummary: "Everything above, plus lead assignment, a shared pipeline, and team reporting.",
        price: "$3,500+",
        cadence: "+ $299 per month",
        bestFor: "A small team that needs every lead assigned and visible.",
        customerCan: ["Reach the right agent faster", "Receive consistent updates", "Book the next step online"],
        ownerGets: ["Lead assignment rules", "A shared sales pipeline", "Team response and source reporting"],
      },
    ],
    "An open-house visitor scans the property QR code, asks about that exact listing, and the lead reaches the right agent with the source attached.",
  ),
  offer(
    "restaurants-cafes",
    "Restaurants, cafés, bakeries and caterers",
    "Restaurants & cafés",
    ["restaurant", "cafe", "coffee shop", "bakery", "caterer", "food truck", "private dining"],
    "Put the menu, directions, ordering, reservations, and event inquiries where guests can find them in seconds.",
    ["Easy menu and directions", "More event inquiries", "Repeat-guest offers"],
    [
      {
        name: "Restaurant Website",
        plainSummary: "A fast mobile website with your menu, hours, map, ordering link, and inquiry emails.",
        price: "$650 setup",
        cadence: "+ $29 per month",
        bestFor: "A local restaurant whose menu or basic information is hard to find.",
        customerCan: ["Read the menu on a phone", "Get directions or call in one tap", "Order, reserve, or ask about an event"],
        ownerGets: ["Easy menu updates", "Clear links to existing ordering tools", "Email alerts for catering or event inquiries"],
      },
      {
        name: "Website + Guest Follow-Up",
        plainSummary: "Everything above, plus review requests and opt-in offers for slow days or special events.",
        price: "$1,250 setup",
        cadence: "+ $99 per month",
        bestFor: "A restaurant that wants more repeat visits, catering, or private events.",
        customerCan: ["Join an offer list by choice", "Get event or reservation follow-up", "Leave a review after a visit"],
        ownerGets: ["Review request messages", "Offer and event email campaigns", "A guest and inquiry list you control"],
        featured: true,
      },
      {
        name: "Multi-Location Automation",
        plainSummary: "Connect locations, inquiry routing, and existing restaurant tools in one custom workflow.",
        price: "$3,000+",
        cadence: "monthly cost quoted after review",
        bestFor: "A busy or multi-location restaurant group.",
        customerCan: ["Choose the right location", "Reach the right event contact", "Receive consistent updates"],
        ownerGets: ["Location and staff routing", "Connections to approved tools", "A simple owner reporting view"],
      },
    ],
    "A guest finds the menu on a phone, books or orders in one tap, then sends a private-event request that reaches the right person instead of a forgotten inbox.",
  ),
  offer(
    "spas-fitness",
    "Spas, massage, gyms and fitness studios",
    "Spas & fitness",
    ["spa", "med spa", "massage", "gym", "fitness studio", "yoga", "pilates", "personal trainer"],
    "Make services, classes, packages, and booking simple from a phone—and make return visits easier.",
    ["Easy service booking", "Fewer no-shows", "More renewals"],
    [
      {
        name: "Booking Website",
        plainSummary: "A website customers can save to their phone like an app, with services, scheduling, and emails.",
        price: "$650 setup",
        cadence: "+ $39 per month",
        bestFor: "A solo provider or studio that needs a calmer booking experience.",
        customerCan: ["Compare services or classes", "Book from any phone", "Get a confirmation email"],
        ownerGets: ["A branded mobile website", "Booking and calendar setup", "A customer and appointment list"],
      },
      {
        name: "Booking + Text Reminders",
        plainSummary: "Everything above, plus text reminders, easy changes, and package-renewal prompts.",
        price: "$1,350 setup",
        cadence: "+ $119 per month",
        bestFor: "A studio that wants fewer no-shows and more package renewals.",
        customerCan: ["Get a reminder before a visit", "Reschedule from one link", "Receive a renewal reminder"],
        ownerGets: ["Automated reminders", "Renewal and rebooking lists", "Simple monthly reporting"],
        featured: true,
      },
      {
        name: "Studio Operations System",
        plainSummary: "Connect staff, rooms, memberships, and approved tools in a custom system.",
        price: "$3,500+",
        cadence: "monthly cost quoted after review",
        bestFor: "A growing studio with several providers, rooms, or locations.",
        customerCan: ["Book the right provider or room", "Manage the next step clearly", "Receive consistent updates"],
        ownerGets: ["Staff and room workflow", "Approved software connections", "An owner dashboard"],
      },
    ],
    "A client compares services, books from a phone, gets a reminder, and receives a package-renewal prompt only when it is relevant.",
  ),
  offer(
    "home-services",
    "Home-service companies and contractors",
    "Home services",
    ["plumber", "electrician", "HVAC", "cleaner", "landscaper", "roofer", "contractor", "handyman", "pest control"],
    "Capture calls and quote requests while you are on a job, then keep estimates and follow-up from getting lost.",
    ["Fewer missed leads", "Better quote requests", "Faster owner alerts"],
    [
      {
        name: "Service Website + Quote Form",
        plainSummary: "A mobile website with services, coverage areas, quote requests, and email alerts.",
        price: "$750 setup",
        cadence: "+ $79 per month",
        bestFor: "An owner-operator who misses calls while working on-site.",
        customerCan: ["See whether you cover their area", "Describe the job and request a quote", "Get confirmation that the request arrived"],
        ownerGets: ["Service and area pages", "A clear quote-request form", "Instant lead alerts by email or text"],
      },
      {
        name: "Quote Form + Automatic Follow-Up",
        plainSummary: "Everything above, plus missed-call replies, estimate follow-up, and scheduling links.",
        price: "$1,750 setup",
        cadence: "+ $149 per month",
        bestFor: "A company losing jobs between the first call and an approved estimate.",
        customerCan: ["Get a fast reply after a missed call", "Send useful job details or photos", "Choose the next available step"],
        ownerGets: ["Automatic first response", "A qualified lead list", "Estimate and follow-up reminders"],
        featured: true,
      },
      {
        name: "Field Operations System",
        plainSummary: "Connect lead intake, estimates, scheduling, and technicians in one custom workflow.",
        price: "$5,000+",
        cadence: "monthly cost quoted after review",
        bestFor: "A growing contractor coordinating several technicians.",
        customerCan: ["Receive clear job updates", "Know who is coming and when", "Approve the next step"],
        ownerGets: ["Job assignment and status views", "Approved software connections", "Team and lead reporting"],
      },
    ],
    "A homeowner calls while the owner is on a job, receives a quick reply, sends the needed details, and enters an organized estimate follow-up list.",
  ),
  offer(
    "professional-services",
    "Law firms, accountants, agencies and consultants",
    "Professional services",
    ["lawyer", "law firm", "accountant", "CPA", "insurance agency", "consultant", "marketing agency", "architect"],
    "Explain your value clearly, collect the right consultation details, and follow up without inbox chaos.",
    ["Clear service pages", "Better consultation requests", "Organized follow-up"],
    [
      {
        name: "Professional Website + Consultation Form",
        plainSummary: "A clear website with service pages, consultation requests, and email alerts.",
        price: "$1,250 setup",
        cadence: "+ $49 per month",
        bestFor: "An expert or small firm whose website does not explain why clients should call.",
        customerCan: ["Understand your services", "See who you are a fit for", "Request a consultation"],
        ownerGets: ["Plain-language service pages", "A consultation form", "Analytics and email alerts"],
      },
      {
        name: "Consultations + Follow-Up",
        plainSummary: "Everything above, plus lead sorting, automatic follow-up, and proposal handoff.",
        price: "$2,500 setup",
        cadence: "+ $149 per month",
        bestFor: "A firm that needs a consistent process from inquiry to proposal.",
        customerCan: ["Send the right background information", "Book the next conversation", "Receive clear next steps"],
        ownerGets: ["Lead qualification and routing", "Follow-up messages", "A simple proposal and pipeline workflow"],
        featured: true,
      },
      {
        name: "Ongoing Systems Partner",
        plainSummary: "Senior monthly help improving software, vendors, automations, and reporting.",
        price: "$1,500+ per month",
        cadence: "three-month minimum",
        bestFor: "A firm that needs technical ownership without hiring a full-time engineer.",
        customerCan: ["Use a more consistent client process", "Get clearer updates", "Spend less time repeating information"],
        ownerGets: ["A practical technology roadmap", "Vendor and integration help", "A monthly improvement and shipping schedule"],
      },
    ],
    "A prospective client understands the firm's fit, requests a consultation with the right context, and receives a clear next step without repeated email chasing.",
  ),
  offer(
    "auto-services",
    "Auto repair shops, detailers and mobile mechanics",
    "Auto services",
    ["auto repair", "mechanic", "body shop", "car detailer", "mobile mechanic", "tire shop"],
    "Turn calls, vehicle details, photos, and estimate requests into a clear service process.",
    ["Clear service requests", "Estimate follow-up", "Maintenance reminders"],
    [
      {
        name: "Shop Website + Service Request",
        plainSummary: "A mobile website with services, directions, service requests, and confirmation emails.",
        price: "$750 setup",
        cadence: "+ $39 per month",
        bestFor: "An independent shop that needs a clearer way to request service.",
        customerCan: ["See services and shop information", "Describe the car and problem", "Request an appointment or estimate"],
        ownerGets: ["A branded shop website", "Vehicle and service request form", "Email alerts for new requests"],
      },
      {
        name: "Service Requests + Follow-Up",
        plainSummary: "Everything above, plus photo requests, estimate follow-up, and maintenance reminders.",
        price: "$1,750 setup",
        cadence: "+ $129 per month",
        bestFor: "A shop losing work after the first call or estimate.",
        customerCan: ["Send useful photos", "Receive the next step after an estimate", "Get a future maintenance reminder"],
        ownerGets: ["Organized request and photo routing", "Estimate follow-up reminders", "A returning-customer list"],
        featured: true,
      },
      {
        name: "Shop Operations System",
        plainSummary: "Connect requests, estimates, status updates, and existing shop software.",
        price: "$5,000+",
        cadence: "monthly cost quoted after review",
        bestFor: "A busy or multi-location automotive business.",
        customerCan: ["Receive status updates", "Approve the next step", "Know when the vehicle is ready"],
        ownerGets: ["A connected service workflow", "Staff status views", "Owner reporting"],
      },
    ],
    "A driver describes the vehicle and issue, sends useful photos, and receives the next step while the shop keeps the request and estimate history together.",
  ),
  offer(
    "pet-care",
    "Pet groomers, daycares, boarders and veterinarians",
    "Pet care",
    ["pet groomer", "dog groomer", "pet daycare", "dog boarding", "veterinarian", "vet", "dog walker"],
    "Make booking, basic pet details, reminders, and repeat care easier for busy owners.",
    ["Easy online booking", "Clear pet intake", "Repeat-care reminders"],
    [
      {
        name: "Pet-Care Booking Website",
        plainSummary: "A website customers can save to their phone like an app, with services, booking, and emails.",
        price: "$650 setup",
        cadence: "+ $39 per month",
        bestFor: "A groomer, walker, or small local pet-care business.",
        customerCan: ["See services and policies", "Request or book a time", "Get a confirmation email"],
        ownerGets: ["A branded mobile website", "Basic pet and booking intake", "A customer and appointment list"],
      },
      {
        name: "Booking + Text Reminders",
        plainSummary: "Everything above, plus reminder texts and prompts to book the next visit.",
        price: "$1,350 setup",
        cadence: "+ $99 per month",
        bestFor: "A team that wants fewer no-shows and more repeat appointments.",
        customerCan: ["Get an appointment reminder", "Change a booking from one link", "Receive a repeat-care reminder"],
        ownerGets: ["Automatic reminders", "A rebooking list", "Simple appointment reporting"],
        featured: true,
      },
      {
        name: "Pet Business Operations System",
        plainSummary: "Connect staff, capacity, intake, and approved business tools.",
        price: "$3,500+",
        cadence: "monthly cost quoted after review",
        bestFor: "A daycare, boarding facility, veterinary office, or multi-provider team.",
        customerCan: ["Choose the right service", "Receive clear updates", "Know the next step"],
        ownerGets: ["Staff and capacity routing", "Approved system connections", "An owner dashboard"],
      },
    ],
    "A pet owner chooses the service, provides basic pet details, books a time, and gets a reminder when the next grooming or care visit is due.",
  ),
  offer(
    "retail",
    "Retail shops, boutiques and specialty stores",
    "Retail stores",
    ["retail store", "boutique", "gift shop", "specialty store", "jewelry store", "clothing store", "florist"],
    "Help nearby shoppers find you, see what is special, hear about events or product drops, and return.",
    ["Better local discovery", "Event and pickup requests", "Customer offer list"],
    [
      {
        name: "Local Store Website",
        plainSummary: "A fast mobile website with products, hours, directions, pickup or event requests, and emails.",
        price: "$750 setup",
        cadence: "+ $39 per month",
        bestFor: "An independent store that needs a stronger online first impression.",
        customerCan: ["See featured products", "Find hours and directions", "Ask about pickup, stock, or an event"],
        ownerGets: ["A branded mobile website", "Simple product and event updates", "Email alerts for customer requests"],
      },
      {
        name: "Website + Customer Offers",
        plainSummary: "Everything above, plus QR signup pages and messages for drops, events, and offers.",
        price: "$1,500 setup",
        cadence: "+ $119 per month",
        bestFor: "A store that runs product launches, events, or repeat-customer offers.",
        customerCan: ["Join your list by choice", "Hear about drops or events", "Move from social media to the right page"],
        ownerGets: ["QR and social signup pages", "Email or text campaign workflow", "A customer list you control"],
        featured: true,
      },
      {
        name: "Retail System Connection",
        plainSummary: "Connect the website to approved point-of-sale, inventory, or online-store tools.",
        price: "$4,000+",
        cadence: "monthly cost quoted after review",
        bestFor: "A store with several sales channels or locations.",
        customerCan: ["Get more accurate product information", "Use a consistent pickup or event flow", "Receive clear updates"],
        ownerGets: ["A systems and data review", "Approved software connections", "Sales and campaign reporting"],
      },
    ],
    "A nearby shopper sees featured products, checks hours, asks about pickup, and chooses to join the store's own list for the next event or product drop.",
  ),
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
