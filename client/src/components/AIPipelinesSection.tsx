import { useState } from "react";
import { Bot, PhoneCall, CalendarClock, FileSearch, Image, Users, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const TABS = [
  {
    id: "local",
    label: "Local services",
    icon: PhoneCall,
    pipelines: [
      { name: "AI Voice Receptionist", desc: "Answer approved questions and route booking requests, with human handoff and outage handling defined before launch." },
      { name: "Smart Dispatch & Scheduling", desc: "Fills your calendar, clusters jobs by route, sends arrival texts, follows up on unsold quotes." },
      { name: "Review Follow-Up", desc: "Invite customers to leave honest feedback with the same review options for everyone, regardless of sentiment." },
    ],
  },
  {
    id: "clinic",
    label: "Clinics & dental",
    icon: CalendarClock,
    pipelines: [
      { name: "AI Appointment Scheduler", desc: "Handle approved booking and reminder workflows, subject to supported integrations, consent, and staff review." },
      { name: "Patient Intake Automation", desc: "Forms, insurance verification, reminders — handled before the patient walks in." },
      { name: "Recall Engine", desc: "Finds patients who haven't booked in 6+ months and brings them back automatically." },
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise & pharma",
    icon: Users,
    pipelines: [
      { name: "Recruiting Workflow Support", desc: "Organize applications against agreed criteria. Hiring decisions remain with your team." },
      { name: "Document Intelligence", desc: "Scans invoices, contracts, reports at scale — extracts data, flags anomalies, routes approvals." },
      { name: "Meeting-to-Action Engine", desc: "Every call transcribed, summarized, action items assigned and tracked." },
    ],
  },
  {
    id: "visual",
    label: "Retail & ecommerce",
    icon: Image,
    pipelines: [
      { name: "Visual Product Search", desc: "Customers snap a photo — AI finds the product in your catalog instantly." },
      { name: "Abandoned-Cart Recovery", desc: "AI follows up on abandoned carts with personalized, perfectly-timed messages." },
      { name: "Inventory Intelligence", desc: "Reads sales patterns and flags what to restock, discount, or drop." },
    ],
  },
  {
    id: "legal",
    label: "Legal & real estate",
    icon: FileSearch,
    pipelines: [
      { name: "Document Scanner", desc: "Reads contracts, disclosures, discovery — flags risks and deadlines in minutes, not days." },
      { name: "AI Lead Qualifier", desc: "Chats with every new lead in seconds, scores intent, books consultations on your calendar." },
      { name: "Deadline Reminders", desc: "Track recorded deadlines and escalate reminders. Your team verifies dates and remains responsible for filings." },
    ],
  },
];

export default function AIPipelinesSection() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <section className="border-y border-border bg-muted/40 px-4 py-16 md:py-24">
      <div className="site-shell">
        <p className="site-eyebrow mb-4 text-center">AI pipelines by industry</p>
        <h2 className="mx-auto max-w-3xl text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl text-balance">
          Automation options to review for your business
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Your free audit suggests possible systems. Scope, costs, data permissions, and expected benefits need validation before implementation.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                active === t.id
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-3">
          {tab.pipelines.map((p) => (
            <Card key={p.name} className="border-border bg-card">
              <CardContent className="p-6">
                <Bot className="h-6 w-6 text-brand-700" />
                <p className="mt-3 font-semibold text-foreground">{p.name}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{p.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mx-auto mt-8 flex max-w-2xl items-center justify-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
          <TrendingUp className="h-8 w-8 shrink-0 text-emerald-500" />
          <p className="text-sm leading-6 text-foreground">
            <strong>Check the economics:</strong> compare your actual request volume, staff time, software costs, and exception handling. Savings estimates are scenarios until measured in your workflow.
          </p>
        </div>
      </div>
    </section>
  );
}
