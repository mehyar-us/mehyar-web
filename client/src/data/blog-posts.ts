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
          "Before adding an assistant, measure request volume, first-response time, assignment failures, and the number of leads with no next task. AI summarizes and drafts best when a workflow has an accountable owner.",
        ],
      },
    ],
    tags: ["Real Estate", "CRM", "Follow-up", "Landing Pages"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
  {
    id: 10,
    title:
      "What Does a Business Audit Check? Your Website, Booking Path, and Follow-Up",
    slug: "what-does-a-business-audit-check",
    date: "2026-10-22",
    author: "Mehyar Swelim",
    category: "Operations",
    excerpt:
      "What does a business audit check? Your site, booking path, and follow-up — leaks priced in dollars, fixes ranked. Free scan first, $330 full audit.",
    readTime: 7,
    image: "/blog/what-does-a-business-audit-check/audit-website-leak-review-real.webp",
    content: [
      "A customer finds your bakery on her phone at 7 a.m. and wants a birthday cake for Saturday. The menu loads, the prices are there — but there is no order button she can find, the phone number is an image she cannot tap, and the contact form asks for six things before it will send. She closes the tab and orders down the street. You never hear about it. That is the moment the question forms: what does a business audit check — and would it have caught this?",
      "Not your taxes, and not your bookkeeping. This audit checks the public path a customer walks to reach you: your website, your booking path, and your follow-up, read the way a first-time buyer reads them.",
    ],
    sections: [
      {
        title: "The problem: leaks you cannot see from inside",
        content: [
          "Owners usually sense the leak before they can point at it. The phone is quieter than it should be. Inquiries arrive, then go cold. Customer details sit in a spreadsheet someone retypes into another tool every Friday. Each gap looks small alone, which is why they survive: nobody lays the whole path end to end and prices what falls out.",
          "The common leaks are unglamorous and specific: a homepage that never says plainly what to do next; a booking path with too many fields, no confirmation, and no alert when a request lands; calls that ring out and are never followed up because nothing tracks them; follow-up that depends on someone remembering; and trust gaps a buyer spots in seconds — no clear service area, no prices or ranges, reviews nowhere in sight.",
          "An audit turns that into a ranked list: this leak first, that one second, this one can wait.",
        ],
      },
      {
        title: "What does a business audit check, area by area?",
        content: [
          "Audit My Business (mehyar.us/audit) works in three steps, following the customer's path in order.",
          "1. Your website, read like a first-time buyer. You paste in your URL — that is the whole intake. The audit fetches your public site itself, finds your business details, and reads the pages as a stranger would: Is the offer clear in the first screen? Does each page say what happens next? Does the mobile path work? Where would a buyer give up? Every finding is tied to the page evidence behind it, not a generic checklist.",
          "2. How you sell, book, and follow up. The full audit goes past the homepage: the form fields a prospect faces, the call and email handoff, whether a request gets a confirmation, and whether a missed inquiry stays visible or disappears. This is where most money leaks live — a clear website feeding a broken booking path still loses the customer.",
          "3. Your own walkthrough, if you add one. An optional step most audits do not have: record a short video — even 2 minutes works, up to 30 minutes of MP4 — talking through your business the way you would show a friend. The audit transcribes it and adds findings from your own words, catching leaks a website cannot show: the manual retyping, the follow-up step that lives in one person's head, the service you sell constantly but never list.",
        ],
      },
      {
        title: "What you actually receive",
        content: [
          "The report is a visual report, emailed with a permanent link. It contains an overall score from 0 to 100 with what it measures; your money leaks, ranked by estimated dollar impact; the flaws found in your site, messaging, and conversion path; prioritized fixes — what to do first, second, and third; a map of where software help fits your business; and transcript-based findings, if you added the walkthrough video.",
          "Three depths, and you choose how far to go. The free scan (mehyar.us/audit/free) takes about 10 seconds with no card: a score snapshot, your top 3 money leaks priced in dollars, and 3 quick wins you can do today. The Full Report is $5, one-time, website only — every page graded, every leak priced with the math shown, plus a capacity blueprint and a 90-day plan, delivered in about a minute. The full audit is $330, one-time, for the whole business, delivered by email within 3–5 business days. Bought the $5 report first with the same email, and its $5 is credited: you pay $325, discount shown before you pay. (Both paid reports are currently paused while we restore full report generation; the free scan runs as always, and the credit applies when the paid reports reopen.)",
          "One distinction: a separate founder-led $330 tech audit (mehyar.us/micro-offer) also exists — a human review, invoiced by email. Same price, different product. This article is about the audit that starts from your URL.",
        ],
      },
      {
        title: "A worked example: the bakery's Saturday cake",
        content: [
          "Here is what this looks like in practice, as an example — a fictional bakery, with the math labeled the way the report labels it.",
          "Say the audit finds the mobile order path broken as above: no tappable number, a six-field form, no confirmation. The report prices that leak with assumptions shown: a stated average cake ticket, multiplied by the ready buyers turned away each week, over a month. Disagree with an assumption and you can redo the math with your own figures — it is printed next to the number.",
          "The fix list ranks by impact: make the number tappable and cut the form to three fields first, add an automatic confirmation second, and defer the prettier gallery page — the gallery was never the leak. That ordering is the point of paying for a check before a rebuild. Our earlier note on finding revenue leaks before buying more software (mehyar.us/blog/small-business-tech-audit-revenue-leaks) covers the same logic from the founder-led side.",
        ],
      },
      {
        title: "Who this is for — and who it is not for",
        content: [
          "It fits you if you run an owner-led business — a local service company, clinic, restaurant, shop, or agency — suspect leads are leaking through unclear website flow, missed calls, slow follow-up, or tools that do not connect, and want the smallest useful next move before a bigger build.",
          "It is not for you if you need a financial, tax, or compliance audit — this check reads your public customer path, not your books. Nor is it a guarantee: it shows what is true today, ranked by estimated impact, and no audit can promise specific revenue results. Replacing your site anyway? Start with the free scan and save the $330 for the new one.",
        ],
      },
      {
        title: "Frequently asked questions",
        content: [
          "What does a business audit check first? Your public website, starting with the homepage and service pages: whether the offer is clear, the next step obvious, the mobile path working, and where trust gaps make a first-time buyer hesitate. The full audit then checks how you sell, book, and follow up.",
          "Do I need the walkthrough video? No. The audit works on your public site alone. The video — 2 to 30 minutes, phone footage is fine — unlocks the deeper section: findings drawn from the transcript of you explaining your business, including manual steps and follow-up gaps a website cannot show.",
          "How much does it cost, and is there a subscription? No subscription. The scan is free with no card. The Full Report is $5, one-time. The full audit is $330, one-time — or $325 at checkout if you bought the $5 report first with the same email, since the $5 is credited.",
          "How long until I get the report? The free scan takes about 10 seconds, the $5 Full Report about a minute. The full $330 audit arrives by email, with a permanent link, within 3–5 business days. (Paid reports are currently paused while report generation is restored.)",
          "What if I only want the quick wins? Take them. The free scan names 3 quick wins you can do today, and the report is a standalone deliverable — stop at the written plan, or act on the first fix yourself.",
        ],
      },
      {
        title: "Start with the free scan",
        content: [
          "Paste your URL into the free scan (mehyar.us/audit/free) and see your score, top 3 priced leaks, and 3 quick wins in about a minute — no card. If it names a leak worth chasing, start the full Audit My Business (mehyar.us/audit) for the ranked fix list for your whole business.",
        ],
      },
    ],
    tags: ["Business Audit", "Tech Audit", "Local Business", "Conversion"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
  {
    id: 11,
    title: "Signs Your Website Is Costing You Customers",
    slug: "signs-your-website-is-costing-you-customers",
    date: "2026-10-23",
    author: "Mehyar Swelim",
    category: "Operations",
    excerpt:
      "Signs your website is costing you customers: five silent give-up moments to check in minutes, plus a free scan — score, 3 leaks, 3 quick wins.",
    readTime: 7,
    image: "/blog/signs-your-website-is-costing-you-customers/signs-website-costing-customers-real.webp",
    content: [
      "It is 6:40 on a Tuesday morning. A homeowner's water heater has quit, she searches on her phone, and your shop is the second result. Your page loads. The number is right there at the top — as a picture. She taps it. Nothing happens. She gives up and calls the first result instead. You were open, you were closer, and you never knew she existed. That quiet moment is one of the clearest signs your website is costing you customers.",
      "Nobody complains about these moments; a buyer who cannot reach you just becomes someone else's job. What you see is a phone that rings less than it should. Below are five give-up moments, each with a check you can run in minutes.",
    ],
    sections: [
      {
        title: "The signs your website is costing you customers, one by one",
        content: [
          "1. The phone number will not tap to call. On a phone, your number should be a button, not a sentence. If it sits in a logo image or plain text with no call link behind it, a visitor must copy it by hand — and most will not bother. Check it yourself: open your site on your phone and tap the number everywhere it appears — header, contact page, footer. If any copy does not open your dialer, that is leak number one.",
          "2. The form asks for too much, too soon. Every extra field is a small decision. A form that wants a full address, a budget, and a preferred date before accepting a simple \"can you fix this?\" turns ready buyers into people who will \"come back later.\" They do not. Check it yourself: count the fields, then submit one on your phone. If it takes more than a minute, trim it to name, contact, and the problem.",
          "3. Nothing confirms the request went through. She fills in the form, presses send, and the page just sits there. Did it send? Most buyers assume it vanished and move to a competitor whose site said \"Got it — we reply within the hour.\" Check it yourself: after your test submission, look for an on-screen confirmation and a confirmation email or text. If either is missing, visitors guess — and guessing buyers leave.",
          "4. Nobody owns what happens next. The form worked — and the request landed in an inbox nobody checks until Friday. To the customer, that is identical to being ignored. Follow-up that depends on one person remembering fails whenever that person is busy, sick, or on a roof. Check it yourself: ask, out loud, \"when a request comes in tonight, whose job is the reply, and how fast?\" A shrug means you found the leak your website cannot show you.",
          "5. Your proof is invisible. Buyers look for evidence before prices: recent reviews, photos of real work, a named service area, clear hours. If your reviews live only on a profile your site never links to, a stranger sees claims with nothing behind them. Check it yourself: open your homepage as a stranger and time the hunt for a review, a real photo, and your service area. More than a few seconds means it is effectively not there.",
        ],
      },
      {
        title: "How Audit My Business checks the same five moments",
        content: [
          "Run the checks above — they take minutes. What Audit My Business (mehyar.us/audit) adds is a measured read of the whole public path, every finding tied to its page.",
          "The free scan (mehyar.us/audit/free) is the starting point, and it is running today: paste your URL for an instant, signal-based analysis of your public site — measured checks of load, contact paths, trust signals, and content — and get a score, your top 3 money leaks priced in dollars, and 3 quick wins you can do today. About 10 seconds, $0, no card — just an email address for delivery.",
          "The Full Report, $5 one-time, is the complete written breakdown of the scan: every leak found, priced and ranked. The full audit, $330 one-time, reads the whole business — your site plus an optional walkthrough video of 2 to 30 minutes, transcribed and assessed — and delivers a visual report by email within 3 to 5 business days: overall score, money leaks ranked by dollar impact, flaws, fixes in priority order, and where software help fits. A $5 report bought first is credited in full — $330 minus $5 is $325 at checkout — and the credit stays yours while checkouts are paused and applies when they reopen. One honest note: paid checkouts for both paid reports are currently paused while the assessment engine is restored, so no charge can be taken today. Our companion piece on what a business audit checks (mehyar.us/blog/what-does-a-business-audit-check) covers the full report section by section.",
        ],
      },
      {
        title: "A worked example: the heater shop's quiet Tuesday",
        content: [
          "A fictional heating shop, with the math labeled the way a report labels it: the owner runs the phone check and finds the header number baked into the logo image. The form asks for six fields. The confirmation passes — but requests land in a shared inbox opened twice a week, and the homepage shows no reviews. Four of the five, on one ordinary site.",
          "Price the biggest leak the report way, with assumptions shown: the shop's stated average job value, multiplied by ready callers turned away each week by an untappable number and a two-day reply, over a month. The math sits next to the figure. Fix order matters more than the total: make the number tappable and link the reviews this week, cut the form next, and only then argue about a redesign. See finding revenue leaks before buying more software (mehyar.us/blog/small-business-tech-audit-revenue-leaks) for the same logic.",
        ],
      },
      {
        title: "Who this is for — and who it is not for",
        content: [
          "It fits you if you run an owner-led business — a trade, clinic, restaurant, shop, or small agency — your website \"looks fine\" but inquiries feel thinner than your reputation suggests, and you want the broken moments named and priced before paying for a rebuild.",
          "It is not for you if your site already turns visitors into confirmed, promptly answered requests and you can prove it — or if you need a financial or tax audit, which this is not. Nor is it a promise: the scan and reports show what is true on your public path today, ranked by estimated impact, and no check can guarantee revenue results.",
        ],
      },
      {
        title: "Frequently asked questions",
        content: [
          "How long does it take to check my own site? About ten minutes for all five: tap the number, count and submit the form, look for the confirmation, name who owns the reply, and time how fast a stranger finds your reviews.",
          "What does the free scan actually give me? A score, your top 3 money leaks priced in dollars, and 3 quick wins you can do today. It is $0, no card — only an email address for delivery. The deeper, every-leak breakdown is the separate $5 Full Report.",
          "Can I buy the $5 report or the $330 audit today? Not today. Paid checkouts for both paid reports are paused while the assessment engine is restored, and no charge can be taken. Run the free scan; a $5 report bought earlier keeps its $5 credit toward the $330 audit, which applies when checkouts reopen.",
          "My customers mostly call — does the website still matter? The call usually starts on the website: the search, the tap, the number that does or does not dial. Moments one, four, and five are call problems wearing a website's clothes.",
        ],
      },
      {
        title: "Start with the free scan",
        content: [
          "Run the free scan (mehyar.us/audit/free) now: paste your URL and get your score, 3 priced leaks, and 3 quick wins — about 10 seconds, $0, no card. Then work the five checks above. When paid reports reopen, Audit My Business (mehyar.us/audit) holds the full ranked fix list.",
        ],
      },
    ],
    tags: ["Business Audit", "Website", "Local Business", "Conversion"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
  },
];

export default blogPosts;
