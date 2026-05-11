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
  }
];

export default blogPosts;
