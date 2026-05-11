import { Bot, CalendarCheck, CloudCog, Code, Lightbulb, PhoneCall, Users } from "lucide-react";

export interface Service {
  id: string;
  title: string;
  category: string;
  description: string;
  features: string[];
  image: string;
  icon: any;
  bgColorClass: string;
  textColorClass: string;
  hoverColorClass: string;
  badgeColorClass: string;
  badgeBgClass: string;
}

export const services: Service[] = [
  {
    id: "tech-audit",
    title: "Local Business Tech Audit",
    category: "Audit",
    description: "A focused review of your website, booking path, phone/email follow-up, reviews, CRM, and manual admin bottlenecks.",
    features: [
      "Website and landing-page friction review",
      "Missed-call, inbox, booking, and lead-response checks",
      "CRM/spreadsheet/process map with highest-value fixes",
      "Prioritized action plan: fix now, automate next, defer",
      "Best fit for restaurants, clinics, salons, stores, and service businesses",
      "Typical range: $150-$500"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: Lightbulb,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "website-booking-cleanup",
    title: "Website Cleanup, Landing Page & Booking Setup",
    category: "Conversion",
    description: "Make the public-facing path clear: what you offer, who it is for, why to trust you, and how to book or request help.",
    features: [
      "Homepage, service-page, and CTA copy cleanup",
      "Booking/contact intake wiring with practical form fields",
      "Mobile-first layout and navigation fixes",
      "Basic analytics events for leads and conversion steps",
      "Local trust signals: service area, founder story, proof, FAQs",
      "Typical range: $750-$2,500"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: CalendarCheck,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "missed-call-followup",
    title: "AI Missed-Call, SMS & Email Follow-Up Flow",
    category: "Automation",
    description: "Respond faster when prospects call, text, submit forms, or disappear before booking, with consent-safe follow-up logic.",
    features: [
      "Missed-call response script and SMS/email handoff",
      "Lead intake questions for qualification and routing",
      "CRM updates, reminders, and owner notifications",
      "Opt-out language and suppression list planning",
      "Best fit for clinics, restaurants, contractors, agencies, and appointment businesses",
      "Typical range: $1,500-$5,000"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: PhoneCall,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  },
  {
    id: "automation-sprint",
    title: "Internal Automation Sprint",
    category: "Operations",
    description: "Replace repetitive spreadsheet, inbox, document, and reporting work with a lean workflow your team can actually use.",
    features: [
      "Workflow discovery and before/after process map",
      "Spreadsheet-to-dashboard or form-to-task automation",
      "Document, notification, and reporting automations",
      "Role-based handoff notes and simple operating guide",
      "Best fit for small and mid-sized companies with recurring admin work",
      "Typical range: $3,000-$12,000"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: Bot,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "systems-integration",
    title: "System Architecture & Integration Consulting",
    category: "Consulting",
    description: "Senior engineering support for teams that need clearer architecture, safer integrations, or hands-on systems thinking.",
    features: [
      "Architecture review, integration plan, and implementation support",
      "API, data, identity, and workflow design",
      "Auditability, access, and operational-risk review",
      "Fractional senior engineer support by hour or project",
      "Best fit for pharma, healthcare, SaaS, agencies, and regulated teams",
      "Typical range: $100-$175/hr or $5k-$25k/project"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: CloudCog,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "crm-support-retainer",
    title: "Monthly Support Retainer",
    category: "Support",
    description: "Ongoing help for owners who need someone watching the website, intake, automations, CRM hygiene, and small fixes.",
    features: [
      "Website, CRM, automation, and integration support queue",
      "Lead-flow monitoring and small monthly improvements",
      "Reporting on leads, response times, and bottlenecks",
      "Vendor coordination and technical owner support",
      "Best fit after an audit, cleanup, or automation sprint",
      "Typical range: $500-$3,500/mo"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: Users,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  },
  {
    id: "software-builds",
    title: "Custom Software Builds",
    category: "Development",
    description: "When off-the-shelf tools are not enough, build a focused portal, dashboard, internal app, or integration layer around the real workflow.",
    features: [
      "Internal dashboards, portals, forms, and admin tools",
      "API integrations across CRM, email, payments, scheduling, and databases",
      "Authentication, permissions, and audit-friendly data handling",
      "Documentation and practical handoff for operators",
      "Best fit when the workflow is proven and needs a reliable system",
      "Scoped after discovery or architecture review"
    ],
    image: "/assets/mehyarsoft-neutral-card.svg",
    icon: Code,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  }
];

export default services;
