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
    title: "The Small Business Tech Audit: Find Revenue Leaks Before Buying More Software",
    slug: "small-business-tech-audit-revenue-leaks",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Operations",
    excerpt: "A practical framework for finding missed calls, weak CTAs, booking friction, CRM gaps, and manual work before committing to a bigger build.",
    readTime: 5,
    image: "/assets/mehyarsoft-neutral-card.svg",
    content: [
      "Most small businesses do not need a larger software stack first. They need a clear picture of where money and time are leaking: calls that are not answered, forms that do not trigger follow-up, service pages that do not explain the offer, and staff workflows that depend on memory.",
      "A tech audit should be practical. The output is not a 60-page transformation deck. It is a ranked list of fixes with business impact, effort, owner, and next step. The first win should usually be small enough to ship quickly and visible enough to justify the next investment."
    ],
    sections: [
      {
        title: "What to inspect first",
        content: [
          "Start with the customer journey: search result, homepage, service page, CTA, contact form, phone call, booking, confirmation, reminder, and follow-up. If any step is unclear or manual, leads will leak.",
          "Then inspect the operator journey: where staff retype data, chase approvals, copy between tools, or depend on one person knowing the process. That is where automation can reduce drag."
        ]
      },
      {
        title: "What a good audit produces",
        content: [
          "The deliverable should include a prioritized list: fix now, automate next, and defer. It should identify tools involved, compliance considerations, and the smallest useful build."
        ]
      }
    ],
    tags: ["Tech Audit", "Local Business", "CRM", "Conversion"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark"
  },
  {
    id: 2,
    title: "Missed Calls Are a CRM Problem, Not Just a Phone Problem",
    slug: "missed-calls-crm-follow-up",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Automation",
    excerpt: "If a prospect calls and nobody follows up, the business needs an intake and response system: consent-safe SMS, email, routing, and owner visibility.",
    readTime: 4,
    image: "/assets/mehyarsoft-neutral-card.svg",
    content: [
      "A missed call is often treated like a staffing issue. Sometimes it is. But many businesses also lack the system that turns that missed call into a lead record, follow-up task, SMS response, and owner-visible metric.",
      "The goal is not to blast people. The goal is to respond quickly, clearly, and lawfully when someone has already tried to reach the business. Control comes before scale: opt-out language, suppression, audit logs, and sensible routing matter."
    ],
    sections: [
      {
        title: "A basic follow-up flow",
        content: [
          "Capture the call event, create or update a lead, send a short response when appropriate, ask one qualifying question, notify the owner or staff, and schedule a follow-up task."
        ]
      },
      {
        title: "What to avoid",
        content: [
          "Avoid deceptive messages, unsafe mass sending, and automation nobody monitors. A follow-up flow should make the business more responsive, not noisier."
        ]
      }
    ],
    tags: ["Missed Calls", "SMS", "CRM", "Compliance"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark"
  },
  {
    id: 3,
    title: "When to Build Custom Software Instead of Forcing Another SaaS Tool",
    slug: "when-to-build-custom-software",
    date: "2026-05-11",
    author: "Mehyar Swelim",
    category: "Systems",
    excerpt: "Custom software makes sense when the workflow is proven, the handoffs are clear, and off-the-shelf tools create more manual work than they remove.",
    readTime: 6,
    image: "/assets/mehyarsoft-neutral-card.svg",
    content: [
      "Custom software is not the first answer for every business. If the workflow is still changing every week, a spreadsheet and a simple form may be the right temporary system. Build custom when the process is important, repeated, and constrained by tools that do not fit.",
      "The best custom systems usually replace a painful chain of copy-paste work: form to spreadsheet, spreadsheet to email, email to CRM, CRM to report. A focused portal or dashboard can turn that chain into one controlled workflow."
    ],
    sections: [
      {
        title: "Good reasons to build",
        content: [
          "Build when the process is stable enough to encode, the cost of manual work is visible, access and auditability matter, or multiple systems need a clean integration layer."
        ]
      },
      {
        title: "Bad reasons to build",
        content: [
          "Do not build custom software just to copy a generic SaaS tool, chase a trend, or avoid making process decisions. The workflow needs an owner before the software can help."
        ]
      }
    ],
    tags: ["Custom Software", "Systems", "Integrations", "Operations"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark"
  },
  {
      id: 4,
      title: "Rizza App Is Live: A World-Class AI Wingman in Your Pocket",
      slug: "rizza-app-launch-tracking-and-organizing-work-without-the-overhead",
      date: "2026-07-17",
      author: "Mehyar Swelim",
      category: "Apps",
      excerpt: "We shipped Rizza — an AI wingman that reads the dating-app conversation, gets the vibe, and hands you replies that actually land. Witty, flirty, and always you — just sharper.",
      readTime: 3,
      image: "/assets/rizza-logo.png",
      content: [
        "Rizza.app is live. It is the first app we are publicly operating under the MehyarSoft umbrella — and it was built on a simple idea: everyone deserves a wingman.",
        "Staring at a dating-app chat, knowing the perfect reply exists but not being able to find it — we've all been there. Rizza puts a world-class AI wingman in your pocket that reads the conversation, gets the vibe, and hands you replies that actually land. Witty, flirty, and always you — just sharper.",
        "Rizza is also a working example of what MehyarSoft ships for clients: a small, focused consumer app on a boring infrastructure stack (Cloudflare Workers, D1, Pages), launched with a real SEO shell and a real PWA install path from day one."
      ],
      sections: [
        {
          title: "What Rizza does",
          content: [
            "You paste the conversation or open it inside Rizza. The app reads the last few exchanges, reads the vibe, and returns a few reply options — witty, flirty, sincere, or playful, depending on what the moment calls for.",
            "You stay in control of what you actually send. Rizza just removes the overthinking between the screenshot and the reply."
          ]
        },
        {
          title: "Why MehyarSoft operates it",
          content: [
            "Building and operating our own consumer product keeps us honest about the MehyarSoft app playbook. Every friction we hit shipping Rizza — from real-time latency to a clean install flow — is a friction we know how to remove for clients.",
            "If you are considering a custom-app or PWA build, Rizza is a live reference you can click through end-to-end."
          ]
        }
      ],
      tags: ["Rizza", "Apps", "Consumer", "AI Wingman", "Launch"],
      badgeColorClass: "text-primary",
      badgeBgClass: "bg-primary/10",
      textColorClass: "text-primary",
      hoverColorClass: "text-primary-dark"
    },
  {
    id: 5,
    title: "AiMech Is Live: An AI Mechanic for Everyday Car Owners",
    slug: "aimech-app-launch-ai-mechanic-for-everyday-car-owners",
    date: "2026-07-17",
    author: "Mehyar Swelim",
    category: "Apps",
    excerpt: "AiMech.app combines AI-driven technical analysis with workflow automation so everyday car owners can describe a sound, a symptom, or a dashboard light and get a clear next step — without the dealership runaround.",
    readTime: 5,
    image: "/assets/aimech-logo.png",
    content: [
      "AiMech.app is live. It is an intelligent diagnostics and automation platform built for everyday car owners, not for professional technicians who already own an OBD-II scanner and a Snap-on subscription.",
      "Most car problems start with a sentence, not a code: \"There is a clicking sound when I turn left,\" \"The check-engine light came back,\" \"My brakes feel spongy this week.\" AiMech takes that sentence, runs it through AI diagnostics backed by real automotive data, and returns a plain-English answer plus a workflow for what to do next — book a shop, watch and wait, or stop driving immediately.",
      "The goal is not to replace a trusted mechanic. The goal is to make sure you walk into that conversation already knowing what is probably wrong, what it usually costs, and what questions to ask."
    ],
    sections: [
      {
        title: "What AiMech does",
        content: [
          "AiMech combines technical analysis with workflow automation. You describe the problem in your own words; the system pulls together likely causes, severity, and the next step that matches the situation — DIY watch, mobile mechanic, or shop visit.",
          "It also keeps a running history per car, so you are not re-explaining the same squeak every six months."
        ]
      },
      {
        title: "Why this matters for everyday drivers",
        content: [
          "Car ownership is full of asymmetric information. A shop knows what is wrong; you know what you heard. AiMech narrows that gap so you can make a confident decision before paying for diagnostics.",
          "It is also the second live example of MehyarSoft's app-launch playbook: real domain, real PWA, real SEO shell, real analytics — shipped in days, not quarters."
        ]
      }
    ],
    tags: ["AiMech", "Apps", "AI", "Consumer"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark"
  }
];

export default blogPosts;
