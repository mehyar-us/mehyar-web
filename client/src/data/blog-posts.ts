export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  date: string;
  author: string;
  category: string;
  excerpt: string;
  readTime: number;
  image: string;
  content: string[];
  sections?: {
    title: string;
    content: string[];
  }[];
  tags?: string[];
  badgeColorClass: string;
  badgeBgClass: string;
  textColorClass: string;
  hoverColorClass: string;
}

export const blogPosts: BlogPost[] = [
  {
    id: 1,
    title:
      "The Small Business Tech Audit: Find Revenue Leaks Before Buying More Software",
    slug: "small-business-tech-audit-revenue-leaks",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Operations",
    excerpt:
      "A practical framework for finding missed calls, weak CTAs, booking friction, CRM gaps, and manual work before committing to a bigger build.",
    readTime: 5,
    image: "/assets/blog/tech-audit-revenue-leaks.webp",
    content: [
      "Most small businesses do not need a larger software stack first. They need a clear picture of where money and time are leaking: calls that are not answered, forms that do not trigger follow-up, service pages that do not explain the offer, and staff workflows that depend on memory.",
      "A tech audit should be practical. The output is not a 60-page transformation deck. It is a ranked list of fixes with business impact, effort, owner, and next step. The first win should usually be small enough to ship quickly and visible enough to justify the next investment.",
    ],
    sections: [
      {
        title: "What to inspect first",
        content: [
          "Start with the customer journey: search result, homepage, service page, CTA, contact form, phone call, booking, confirmation, reminder, and follow-up. If any step is unclear or manual, leads will leak.",
          "Then inspect the operator journey: where staff retype data, chase approvals, copy between tools, or depend on one person knowing the process. That is where automation can reduce drag.",
        ],
      },
      {
        title: "What a good audit produces",
        content: [
          "The deliverable should include a prioritized list: fix now, automate next, and defer. It should identify tools involved, compliance considerations, and the smallest useful build.",
        ],
      },
    ],
    tags: ["Tech Audit", "Local Business", "CRM", "Conversion"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
  {
    id: 2,
    title: "Missed Calls Are a CRM Problem, Not Just a Phone Problem",
    slug: "missed-calls-crm-follow-up",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Automation",
    excerpt:
      "If a prospect calls and nobody follows up, the business needs an intake and response system: consent-safe SMS, email, routing, and owner visibility.",
    readTime: 4,
    image: "/assets/blog/missed-calls-crm-follow-up.webp",
    content: [
      "A missed call is often treated like a staffing issue. Sometimes it is. But many businesses also lack the system that turns that missed call into a lead record, follow-up task, SMS response, and owner-visible metric.",
      "The goal is not to blast people. The goal is to respond quickly, clearly, and lawfully when someone has already tried to reach the business. Control comes before scale: opt-out language, suppression, audit logs, and sensible routing matter.",
    ],
    sections: [
      {
        title: "A basic follow-up flow",
        content: [
          "Capture the call event, create or update a lead, send a short response when appropriate, ask one qualifying question, notify the owner or staff, and schedule a follow-up task.",
        ],
      },
      {
        title: "What to avoid",
        content: [
          "Avoid deceptive messages, unsafe mass sending, and automation nobody monitors. A follow-up flow should make the business more responsive, not noisier.",
        ],
      },
    ],
    tags: ["Missed Calls", "SMS", "CRM", "Compliance"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
  },
  {
    id: 3,
    title: "When to Build Custom Software Instead of Forcing Another SaaS Tool",
    slug: "when-to-build-custom-software",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Systems",
    excerpt:
      "Custom software makes sense when the workflow is proven, the handoffs are clear, and off-the-shelf tools create more manual work than they remove.",
    readTime: 6,
    image: "/assets/blog/when-to-build-custom-software.webp",
    content: [
      "Custom software is not the first answer for every business. If the workflow is still changing every week, a spreadsheet and a simple form may be the right temporary system. Build custom when the process is important, repeated, and constrained by tools that do not fit.",
      "The best custom systems usually replace a painful chain of copy-paste work: form to spreadsheet, spreadsheet to email, email to CRM, CRM to report. A focused portal or dashboard can turn that chain into one controlled workflow.",
    ],
    sections: [
      {
        title: "Good reasons to build",
        content: [
          "Build when the process is stable enough to encode, the cost of manual work is visible, access and auditability matter, or multiple systems need a clean integration layer.",
        ],
      },
      {
        title: "Bad reasons to build",
        content: [
          "Do not build custom software just to copy a generic SaaS tool, chase a trend, or avoid making process decisions. The workflow needs an owner before the software can help.",
        ],
      },
    ],
    tags: ["Custom Software", "Systems", "Integrations", "Operations"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
  },
  {
    id: 4,
    title: "Rizza App Is Live: A World-Class AI Wingman in Your Pocket",
    slug: "rizza-app-launch-tracking-and-organizing-work-without-the-overhead",
    date: "2026-07-17",
    author: "Mehyar Swelim",
    category: "Apps",
    excerpt:
      "We shipped Rizza — an AI wingman that reads the dating-app conversation, gets the vibe, and hands you replies that actually land. Witty, flirty, and always you — just sharper.",
    readTime: 3,
    image: "/assets/rizza-logo.png",
    content: [
      "Rizza.app is live. It is the first app we are publicly operating under the MehyarSoft umbrella — and it was built on a simple idea: everyone deserves a wingman.",
      "Staring at a dating-app chat, knowing the perfect reply exists but not being able to find it — we've all been there. Rizza puts a world-class AI wingman in your pocket that reads the conversation, gets the vibe, and hands you replies that actually land. Witty, flirty, and always you — just sharper.",
      "Rizza is also a working example of what MehyarSoft ships for clients: a small, focused consumer app on a boring infrastructure stack (Cloudflare Workers, D1, Pages), launched with a real SEO shell and a real PWA install path from day one.",
    ],
    sections: [
      {
        title: "What Rizza does",
        content: [
          "You paste the conversation or open it inside Rizza. The app reads the last few exchanges, reads the vibe, and returns a few reply options — witty, flirty, sincere, or playful, depending on what the moment calls for.",
          "You stay in control of what you actually send. Rizza just removes the overthinking between the screenshot and the reply.",
        ],
      },
      {
        title: "Why MehyarSoft operates it",
        content: [
          "Building and operating our own consumer product keeps us honest about the MehyarSoft app playbook. Every friction we hit shipping Rizza — from real-time latency to a clean install flow — is a friction we know how to remove for clients.",
          "If you are considering a custom-app or PWA build, Rizza is a live reference you can click through end-to-end.",
        ],
      },
    ],
    tags: ["Rizza", "Apps", "Consumer", "AI Wingman", "Launch"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
  {
    id: 5,
    title: "AiMech Is Live: An AI Mechanic for Everyday Car Owners",
    slug: "aimech-app-launch-ai-mechanic-for-everyday-car-owners",
    date: "2026-07-17",
    author: "Mehyar Swelim",
    category: "Apps",
    excerpt:
      "AiMech.app combines AI-driven technical analysis with workflow automation so everyday car owners can describe a sound, a symptom, or a dashboard light and get a clear next step — without the dealership runaround.",
    readTime: 5,
    image: "/assets/aimech-logo.png",
    content: [
      "AiMech.app is live. It is an intelligent diagnostics and automation platform built for everyday car owners, not for professional technicians who already own an OBD-II scanner and a Snap-on subscription.",
      'Most car problems start with a sentence, not a code: "There is a clicking sound when I turn left," "The check-engine light came back," "My brakes feel spongy this week." AiMech takes that sentence, runs it through AI diagnostics backed by real automotive data, and returns a plain-English answer plus a workflow for what to do next — book a shop, watch and wait, or stop driving immediately.',
      "The goal is not to replace a trusted mechanic. The goal is to make sure you walk into that conversation already knowing what is probably wrong, what it usually costs, and what questions to ask.",
    ],
    sections: [
      {
        title: "What AiMech does",
        content: [
          "AiMech combines technical analysis with workflow automation. You describe the problem in your own words; the system pulls together likely causes, severity, and the next step that matches the situation — DIY watch, mobile mechanic, or shop visit.",
          "It also keeps a running history per car, so you are not re-explaining the same squeak every six months.",
        ],
      },
      {
        title: "Why this matters for everyday drivers",
        content: [
          "Car ownership is full of asymmetric information. A shop knows what is wrong; you know what you heard. AiMech narrows that gap so you can make a confident decision before paying for diagnostics.",
          "It is also the second live example of MehyarSoft's app-launch playbook: real domain, real PWA, real SEO shell, real analytics — shipped in days, not quarters.",
        ],
      },
    ],
    tags: ["AiMech", "Apps", "AI", "Consumer"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
  },
  {
    id: 6,
    title:
      "The Barber's Booking System Should Build a Client List, Not a Marketplace Dependency",
    slug: "barber-booking-client-list-not-marketplace-dependency",
    date: "2026-08-26",
    author: "Mehyar Swelim",
    category: "Local Growth",
    excerpt:
      "A practical way for barbers and beauty pros to use a QR code, direct booking, reminders, and rebooking without treating a marketplace profile as their business.",
    readTime: 5,
    image: "/assets/blog/barber-booking-client-ownership.webp",
    content: [
      "For a solo barber, the customer relationship is the business. A directory profile can help discovery, but it should not be the only place a regular can book, see work, or receive a reminder. The first goal is simple: every chair, card, and Instagram bio should lead to a branded mobile booking path that the barber controls.",
      "The useful system is not a giant salon platform. It is a quick mobile page, clear services, a QR code at the chair, confirmations, and a respectful reminder for regulars who have not returned. That gives the barber a direct relationship without making the customer do more work.",
    ],
    sections: [
      {
        title: "Start with the repeat customer",
        content: [
          "Map the regular's journey: see a cut, scan the code or tap the Instagram link, choose a service, book, receive confirmation, and return when it is time. Any extra app download, unclear price, or marketplace detour adds friction.",
        ],
      },
      {
        title: "Use SMS carefully",
        content: [
          "Appointment reminders and requested follow-up can be useful. Promotional texts need clear consent, a simple opt-out, a measured cadence, and an owner who actually monitors replies. The customer list is an asset, not a license to spam.",
        ],
      },
    ],
    tags: ["Barbers", "Booking", "SMS", "Local Business"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
  {
    id: 7,
    title: "A Restaurant Website Has One Job Before It Has Ten Features",
    slug: "restaurant-website-menu-reservations-private-events",
    date: "2026-08-26",
    author: "Mehyar Swelim",
    category: "Hospitality",
    excerpt:
      "Make the next action obvious: view the menu, get directions, reserve, order, or ask about a private event—then connect that signal to someone who can respond.",
    readTime: 4,
    image: "/assets/blog/restaurant-mobile-intent.webp",
    content: [
      "Restaurant websites often try to look like a mood board and forget the person who is deciding where to eat right now. On a phone, the essentials should be immediate: what this place is, where it is, whether it is open, what it serves, and the next appropriate action.",
      "A private-event request is different from a dinner reservation, and catering is different again. Each needs a short route to the right person, an acknowledgement, and a reliable handoff. The site does not need a replacement POS to do this well.",
    ],
    sections: [
      {
        title: "Design for intent, not decoration",
        content: [
          "Put the critical choices above the fold and keep them thumb-friendly: Menu, Directions, Reserve, Order, and Private Events. Then make the same information correct in Google Business Profile and social bios.",
        ],
      },
      {
        title: "Let campaigns earn their place",
        content: [
          "Slow-day offers should go to guests who chose to hear from the business. Start with a clear opt-in, one useful reason to return, and a measurement plan rather than sending every offer to every past customer.",
        ],
      },
    ],
    tags: ["Restaurants", "Hospitality", "Conversion", "Local SEO"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
  },
  {
    id: 8,
    title: "What a Clinic Can Automate Without Putting Patient Trust at Risk",
    slug: "clinic-automation-minimum-data-patient-trust",
    date: "2026-08-26",
    author: "Mehyar Swelim",
    category: "Trust & Safety",
    excerpt:
      "A safer clinic automation strategy starts with minimum-data request routing, clear staff handoffs, and vendor review—not a public AI bot collecting patient history.",
    readTime: 6,
    image: "/assets/blog/clinic-minimum-data-automation.webp",
    content: [
      "Healthcare-adjacent workflows need more restraint than ordinary lead generation. A public website can explain services, capture a general appointment request, send a non-clinical acknowledgement, and route work to staff. It should not invite patients to put sensitive health details into an unreviewed public form or chatbot.",
      "The useful starting point is an inventory: what information arrives, which team needs it, where it is allowed to live, who can access it, and how long it remains. Only then is it sensible to choose automation or a vendor integration.",
    ],
    sections: [
      {
        title: "Automate the handoff, not the diagnosis",
        content: [
          "Use automation for service routing, appointment-request acknowledgement, staff task creation, and general operational reminders. Keep clinical judgement, protected data, and treatment decisions within approved systems and human workflows.",
        ],
      },
      {
        title: "Make the public boundary explicit",
        content: [
          "Tell visitors what the form is for, what not to submit, and how urgent or sensitive needs should be handled. That protects patients and prevents staff from discovering a risky workflow after it is already in use.",
        ],
      },
    ],
    tags: ["Clinics", "Privacy", "Automation", "Intake"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
  },
  {
    id: 9,
    title: "Why a Real Estate Landing Page Needs a Follow-Up Owner",
    slug: "real-estate-landing-page-follow-up-owner",
    date: "2026-08-26",
    author: "Mehyar Swelim",
    category: "Sales Systems",
    excerpt:
      "An open-house QR code or listing page is only valuable when every inquiry has an owner, a next action, and a respectful follow-up timeline.",
    readTime: 4,
    image: "/assets/blog/real-estate-lead-ownership.webp",
    content: [
      "A good listing page earns attention. A working real estate system turns that attention into a clean, timely conversation. The gap is usually not another form—it is the undefined handoff after the form: no owner, no response expectation, no CRM record, and no way to know whether a lead went cold.",
      "Start with the moment of intent: a listing link, an open-house QR code, or a referral. Ask only for what is needed to respond, make the follow-up expectation explicit, and route the request to an accountable person.",
    ],
    sections: [
      {
        title: "Build a route for each intent",
        content: [
          "A buyer inquiry, seller valuation request, rental question, and open-house check-in should not all create the same generic message. Use a short route for each so the team knows the context before replying.",
        ],
      },
      {
        title: "Measure response before adding AI",
        content: [
          "Before adding an assistant, measure request volume, first-response time, assignment failures, and the number of leads with no next task. AI can help summarize and draft; it cannot repair a workflow with no accountable owner.",
        ],
      },
    ],
    tags: ["Real Estate", "CRM", "Follow-up", "Landing Pages"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
];

export default blogPosts;
