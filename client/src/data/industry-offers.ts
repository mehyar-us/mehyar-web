export type IndustryOffer = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  outcomes: string[];
  complianceNote?: string;
  packages: Array<{
    name: string;
    price: string;
    cadence: string;
    bestFor: string;
    includes: string[];
    featured?: boolean;
  }>;
};

// Published starting prices are intentionally clear, while integrations,
// regulated data, paid-message volume, and custom software remain scoped.
export const industryOffers: IndustryOffer[] = [
  {
    id: "barbers-beauty",
    name: "Barbers, salons & beauty pros",
    shortName: "Beauty",
    description:
      "Own the chair, the booking relationship, and the repeat visit—without sending regulars back into a marketplace.",
    outcomes: [
      "QR-to-book flow",
      "no-show reminders",
      "rebooking & win-back campaigns",
    ],
    packages: [
      {
        name: "Chair Launch",
        price: "$495 setup",
        cadence: "+ $25/mo",
        bestFor:
          "A solo barber or beauty pro replacing a profile-only presence.",
        includes: [
          "branded booking PWA",
          "chair QR placard",
          "portfolio & services",
          "email confirmations",
        ],
      },
      {
        name: "Retention Flow",
        price: "$995 setup",
        cadence: "+ $79/mo",
        bestFor:
          "Pros who want reminders, rebooking, and a private customer list.",
        includes: [
          "everything in Chair Launch",
          "SMS reminders and reschedules",
          "3-week win-back prompt",
          "owner dashboard",
        ],
        featured: true,
      },
      {
        name: "Content Engine",
        price: "$1,495 setup",
        cadence: "+ $199/mo",
        bestFor:
          "A busy stylist who needs consistent social proof and booking demand.",
        includes: [
          "everything in Retention Flow",
          "monthly content workflow",
          "reel/post publishing queue",
          "campaign tracking",
        ],
      },
    ],
  },
  {
    id: "clinics",
    name: "Clinics & healthcare practices",
    shortName: "Clinics",
    description:
      "Reduce intake friction and staff chasing without treating a public form or AI chatbot as a place for patient data.",
    outcomes: [
      "clear service routing",
      "appointment-request workflow",
      "staff handoff visibility",
    ],
    complianceNote:
      "Public forms collect only minimum scheduling context. PHI, clinical decisions, and regulated integrations require a scoped compliance review.",
    packages: [
      {
        name: "Patient Path Audit",
        price: "$495",
        cadence: "one-time",
        bestFor: "Practices with confusing services, calls, or request paths.",
        includes: [
          "website & intake audit",
          "routing map",
          "privacy-risk flags",
          "prioritized action plan",
        ],
      },
      {
        name: "Practice Intake",
        price: "$2,500 setup",
        cadence: "+ $149/mo",
        bestFor:
          "Practices needing a privacy-conscious website and request workflow.",
        includes: [
          "service pages",
          "minimum-data request flow",
          "staff notifications",
          "analytics & handoff docs",
        ],
        featured: true,
      },
      {
        name: "Systems Integration",
        price: "$5,000+",
        cadence: "scoped",
        bestFor:
          "Established practices with approved vendors and defined workflows.",
        includes: [
          "integration discovery",
          "role/access plan",
          "audit-friendly workflow",
          "deployment support",
        ],
      },
    ],
  },
  {
    id: "real-estate",
    name: "Real estate agents & teams",
    shortName: "Real estate",
    description:
      "Turn listing attention, referrals, and open-house traffic into an owned follow-up system.",
    outcomes: ["listing landing pages", "lead routing", "open-house follow-up"],
    packages: [
      {
        name: "Agent Presence",
        price: "$750 setup",
        cadence: "+ $39/mo",
        bestFor:
          "An agent who needs a polished local brand and direct inquiry path.",
        includes: [
          "agent website",
          "service areas",
          "lead form",
          "calendar and email routing",
        ],
      },
      {
        name: "Listing Conversion",
        price: "$1,500 setup",
        cadence: "+ $99/mo",
        bestFor: "Agents marketing listings or open houses consistently.",
        includes: [
          "everything in Agent Presence",
          "listing templates",
          "QR sign pages",
          "lead follow-up workflow",
        ],
        featured: true,
      },
      {
        name: "Team Pipeline",
        price: "$3,500+",
        cadence: "+ $299/mo",
        bestFor: "Small teams that need ownership, routing, and reporting.",
        includes: [
          "CRM integration",
          "assignment logic",
          "pipeline dashboard",
          "campaign automation",
        ],
      },
    ],
  },
  {
    id: "restaurants",
    name: "Restaurants, cafés & hospitality",
    shortName: "Restaurants",
    description:
      "Make ordering, private events, reservations, and return visits easier without forcing a new POS.",
    outcomes: [
      "mobile menu and ordering links",
      "private-event inquiry flow",
      "slow-day campaigns",
    ],
    packages: [
      {
        name: "Local Essentials",
        price: "$650 setup",
        cadence: "+ $29/mo",
        bestFor:
          "A restaurant whose online first impression is costing walk-ins.",
        includes: [
          "mobile-first website",
          "menu and location UX",
          "Google/Maps links",
          "event or catering inquiry",
        ],
      },
      {
        name: "Guest Return Flow",
        price: "$1,250 setup",
        cadence: "+ $99/mo",
        bestFor: "Restaurants with events, takeout, or repeat-guest potential.",
        includes: [
          "everything in Local Essentials",
          "reservation/order handoffs",
          "review request workflow",
          "opt-in offer campaigns",
        ],
        featured: true,
      },
      {
        name: "Hospitality Ops",
        price: "$3,000+",
        cadence: "scoped",
        bestFor: "Multi-location or high-volume operators.",
        includes: [
          "workflow audit",
          "vendor integration plan",
          "staff dashboards",
          "custom automation",
        ],
      },
    ],
  },
  {
    id: "spas-wellness",
    name: "Spas, wellness & fitness studios",
    shortName: "Wellness",
    description:
      "A calmer online experience that converts appointments and makes memberships or packages easier to manage.",
    outcomes: [
      "class/service booking",
      "package follow-up",
      "membership retention",
    ],
    packages: [
      {
        name: "Calm Booking",
        price: "$650 setup",
        cadence: "+ $39/mo",
        bestFor: "A studio that needs a clear service and booking experience.",
        includes: [
          "branded site",
          "service/package pages",
          "booking handoff",
          "confirmation emails",
        ],
      },
      {
        name: "Member Momentum",
        price: "$1,350 setup",
        cadence: "+ $119/mo",
        bestFor: "Studios reducing no-shows and driving package renewals.",
        includes: [
          "everything in Calm Booking",
          "reminder workflow",
          "renewal prompts",
          "owner reporting",
        ],
        featured: true,
      },
      {
        name: "Studio Automation",
        price: "$3,500+",
        cadence: "scoped",
        bestFor: "Teams with multiple coaches, rooms, or systems.",
        includes: [
          "operations audit",
          "system integration",
          "staff workflow",
          "custom portal options",
        ],
      },
    ],
  },
  {
    id: "home-services",
    name: "Home services & contractors",
    shortName: "Home services",
    description:
      "Win the job before the callback window closes, then make estimates and scheduling easier to run.",
    outcomes: [
      "missed-call recovery",
      "quote requests",
      "dispatch-ready handoff",
    ],
    packages: [
      {
        name: "Lead Rescue",
        price: "$750 setup",
        cadence: "+ $79/mo",
        bestFor: "An owner missing calls while on-site.",
        includes: [
          "service-area landing page",
          "quote-request intake",
          "owner alerts",
          "missed-call response workflow",
        ],
      },
      {
        name: "Estimate Engine",
        price: "$1,750 setup",
        cadence: "+ $149/mo",
        bestFor: "Companies moving beyond text-message estimates.",
        includes: [
          "everything in Lead Rescue",
          "estimate qualification",
          "photo-upload rules",
          "CRM/calendar handoff",
        ],
        featured: true,
      },
      {
        name: "Operations Hub",
        price: "$5,000+",
        cadence: "scoped",
        bestFor: "Growing contractors coordinating multiple technicians.",
        includes: [
          "job workflow discovery",
          "system integrations",
          "field dashboards",
          "custom internal tool",
        ],
      },
    ],
  },
  {
    id: "professional-services",
    name: "Agencies, legal, accounting & professional services",
    shortName: "Professional services",
    description:
      "Package expertise, qualify the right leads, and remove the manual handoff work around a high-trust sale.",
    outcomes: [
      "authority site",
      "qualified consultation requests",
      "CRM and proposal automation",
    ],
    packages: [
      {
        name: "Authority Site",
        price: "$1,250 setup",
        cadence: "+ $49/mo",
        bestFor:
          "Expert firms that need their website to explain value clearly.",
        includes: [
          "positioning workshop",
          "service page system",
          "consultation intake",
          "analytics baseline",
        ],
      },
      {
        name: "Pipeline Build",
        price: "$2,500 setup",
        cadence: "+ $149/mo",
        bestFor: "Firms standardizing qualification and follow-up.",
        includes: [
          "everything in Authority Site",
          "CRM routing",
          "proposal/brief workflow",
          "follow-up automation",
        ],
        featured: true,
      },
      {
        name: "Fractional Systems Lead",
        price: "$1,500+/mo",
        cadence: "quarterly minimum",
        bestFor:
          "Teams needing a senior technical owner without a full-time hire.",
        includes: [
          "roadmap",
          "vendor coordination",
          "architecture review",
          "monthly shipping cadence",
        ],
      },
    ],
  },
  {
    id: "auto-services",
    name: "Auto repair, detailing & mobile mechanics",
    shortName: "Auto",
    description:
      "Turn calls, symptoms, photos, and estimate requests into a clean service workflow customers can trust.",
    outcomes: [
      "service-request intake",
      "estimate follow-up",
      "maintenance reminders",
    ],
    packages: [
      {
        name: "Shopfront Digital",
        price: "$750 setup",
        cadence: "+ $39/mo",
        bestFor:
          "Independent shops that need clear services and a direct request path.",
        includes: [
          "service website",
          "vehicle/request intake",
          "maps and call actions",
          "email confirmations",
        ],
      },
      {
        name: "Estimate Follow-Up",
        price: "$1,750 setup",
        cadence: "+ $129/mo",
        bestFor:
          "Shops losing work between the first call and approved estimate.",
        includes: [
          "everything in Shopfront Digital",
          "photo/request routing",
          "estimate follow-up",
          "maintenance reminder workflow",
        ],
        featured: true,
      },
      {
        name: "Service Ops Hub",
        price: "$5,000+",
        cadence: "scoped",
        bestFor: "Busy or multi-location operators connecting existing tools.",
        includes: [
          "workflow discovery",
          "approved integrations",
          "status dashboard",
          "custom automation",
        ],
      },
    ],
  },
  {
    id: "pet-care",
    name: "Pet grooming, daycare & local pet services",
    shortName: "Pet care",
    description:
      "Make service selection, booking, pet details, reminders, and repeat visits easier for busy owners.",
    outcomes: ["mobile booking", "safe pet intake", "repeat-service reminders"],
    packages: [
      {
        name: "Easy Booking",
        price: "$650 setup",
        cadence: "+ $39/mo",
        bestFor: "Solo groomers and local pet professionals.",
        includes: [
          "branded mobile site",
          "services and policies",
          "booking handoff",
          "confirmation emails",
        ],
      },
      {
        name: "Repeat Care",
        price: "$1,350 setup",
        cadence: "+ $99/mo",
        bestFor: "Teams that want fewer no-shows and more repeat appointments.",
        includes: [
          "everything in Easy Booking",
          "minimum-data pet intake",
          "reminder workflow",
          "rebooking prompts",
        ],
        featured: true,
      },
      {
        name: "Pet Business Hub",
        price: "$3,500+",
        cadence: "scoped",
        bestFor: "Daycare, boarding, or multi-provider operations.",
        includes: [
          "operations audit",
          "staff routing",
          "system integration",
          "owner dashboard",
        ],
      },
    ],
  },
  {
    id: "retail",
    name: "Retail shops, boutiques & specialty stores",
    shortName: "Retail",
    description:
      "Connect neighborhood discovery, product drops, events, and loyalty without rebuilding the entire commerce stack.",
    outcomes: [
      "local discovery",
      "drop/event campaigns",
      "owned customer opt-ins",
    ],
    packages: [
      {
        name: "Neighborhood Storefront",
        price: "$750 setup",
        cadence: "+ $39/mo",
        bestFor:
          "Independent stores that need a stronger local first impression.",
        includes: [
          "mobile storefront",
          "featured products",
          "hours/maps/contact",
          "event or pickup requests",
        ],
      },
      {
        name: "Drop & Loyalty",
        price: "$1,500 setup",
        cadence: "+ $119/mo",
        bestFor: "Shops running launches, events, or repeat-customer offers.",
        includes: [
          "everything in Storefront",
          "opt-in list growth",
          "campaign workflow",
          "QR and social landing pages",
        ],
        featured: true,
      },
      {
        name: "Retail Integration",
        price: "$4,000+",
        cadence: "scoped",
        bestFor: "Stores connecting POS, inventory, CRM, or ecommerce tools.",
        includes: [
          "systems audit",
          "integration plan",
          "operator reporting",
          "custom workflow",
        ],
      },
    ],
  },
];
