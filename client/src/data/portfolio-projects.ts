import { Activity, Bot, Building, Code, Database, FileText, PhoneCall } from "lucide-react";

export interface PortfolioProject {
  id: number;
  title: string;
  description: string;
  category: string;
  image: string;
  detailImage?: string;
  client: string;
  year: string;
  challenge: string;
  solution: string;
  results: string[];
  technologies: string[];
  badgeColorClass: string;
  badgeBgClass: string;
  textColorClass: string;
  hoverColorClass: string;
  icon?: any;
}

export const projects: PortfolioProject[] = [
  {
    id: 1,
    title: "Local Business Lead Leak Audit",
    description: "A practical audit pattern for finding website, phone, booking, and follow-up gaps before buying more tools.",
    category: "Audit",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "Many local businesses lose leads because the website does not explain the offer, booking is unclear, calls are missed, and follow-up depends on memory.",
    solution: "Map the customer journey from search to booking, inspect the tools involved, identify the highest-value friction points, and produce a prioritized fix plan.",
    results: [
      "Ranked action plan for fix-now, automate-next, and defer items",
      "Clear owner view of where leads are lost",
      "Scope definition for a website cleanup or follow-up automation",
      "No fake metrics; success criteria are agreed before build"
    ],
    technologies: ["Website review", "CRM review", "Call flow", "Booking flow", "Analytics"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: Activity
  },
  {
    id: 2,
    title: "Missed-Call Follow-Up Flow",
    description: "A consent-safe response workflow for prospects who call, submit a form, or need booking follow-up.",
    category: "Automation",
    image: "https://images.unsplash.com/photo-1556745757-8d76bdb6984b?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1556745757-8d76bdb6984b?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "A business may receive intent but fail to capture it in a CRM, route it to staff, or respond quickly enough to win the customer.",
    solution: "Create a lead record, send appropriate follow-up, notify the owner or staff, track response status, and maintain opt-out/suppression handling.",
    results: [
      "Faster response to existing inbound intent",
      "Owner visibility into missed calls and unworked leads",
      "Opt-out and suppression controls planned before scale",
      "A workflow that can be improved based on real activity"
    ],
    technologies: ["CRM", "SMS", "Email", "Webhooks", "Audit log"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: PhoneCall
  },
  {
    id: 3,
    title: "Internal Automation Sprint",
    description: "A focused sprint to replace repetitive spreadsheet, inbox, and reporting work with a clean internal workflow.",
    category: "Operations",
    image: "https://images.unsplash.com/photo-1563986768609-322da13575f3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "Teams often spend hours copying data between forms, spreadsheets, email threads, and reports, which creates delays and avoidable errors.",
    solution: "Document the current workflow, choose one high-value process, build the smallest reliable automation, and provide a handoff guide for operators.",
    results: [
      "One clearly defined workflow automated",
      "Reduced copy-paste and status-chasing for the selected process",
      "Documented handoff for staff and owners",
      "Foundation for dashboarding and future integrations"
    ],
    technologies: ["Forms", "SQL", "Dashboards", "Notifications", "APIs"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    icon: Bot
  },
  {
    id: 4,
    title: "Regulated Systems Integration Review",
    description: "Senior systems review for teams that need safer architecture, cleaner integrations, and better operational control.",
    category: "Systems",
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1552664730-d307ca884978?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "Regulated or operationally sensitive teams need integrations that are understandable, auditable, secure, and supportable after launch.",
    solution: "Review system boundaries, identity, data flow, access, auditability, failure modes, and delivery plan before implementation or rescue work.",
    results: [
      "Clear integration map and risk list",
      "Implementation plan with access and audit considerations",
      "Reduced ambiguity for technical and non-technical owners",
      "Support path for build, handoff, or retainer"
    ],
    technologies: ["Architecture", "APIs", "Identity", "Databases", "Auditability"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: Database
  },
  {
    id: 5,
    title: "Website and Booking Cleanup",
    description: "A conversion-focused cleanup for businesses whose referrals, ads, or search traffic land on unclear pages.",
    category: "Conversion",
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1547658719-da2b51169166?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "Owners may have a website, but visitors still cannot quickly understand the offer, trust the business, or complete the next step.",
    solution: "Rewrite key pages, clarify CTAs, reduce navigation friction, add practical proof, and wire the contact or booking path.",
    results: [
      "Clear service positioning and next step",
      "Better mobile-first intake path",
      "Copy aligned to real offers and price ranges",
      "Analytics-ready conversion points"
    ],
    technologies: ["React", "Copywriting", "Booking", "Forms", "Analytics"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Code
  },
  {
    id: 6,
    title: "Owner Dashboard and Support Retainer",
    description: "A monthly support pattern for keeping lead flow, CRM hygiene, small fixes, and operational dashboards moving.",
    category: "Support",
    image: "https://images.unsplash.com/photo-1549923746-c502d488b3ea?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1549923746-c502d488b3ea?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Reference engagement pattern",
    year: "Current",
    challenge: "After launch, owners still need someone watching the system, improving the workflow, and handling technical vendors or small changes.",
    solution: "Define a monthly support lane with reporting, small fixes, CRM cleanup, workflow improvements, and escalation for larger builds.",
    results: [
      "Ongoing technical owner support",
      "Monthly visibility into leads and workflow issues",
      "Cleaner backlog of fixes and improvements",
      "A path from one-off project to durable operating system"
    ],
    technologies: ["Dashboard", "CRM", "Reporting", "Support queue", "Documentation"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    icon: Building
  }
];

export default projects;
