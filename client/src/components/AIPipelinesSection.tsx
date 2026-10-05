import { useState } from "react";
import { Bot, PhoneCall, CalendarClock, FileSearch, Image, Users, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const TABS = [
  {
    id: "local",
    label: "Local services",
    icon: PhoneCall,
    pipelines: [
      { name: "AI Voice Receptionist", desc: "Answers every call 24/7, books jobs, quotes prices. Never miss a 2am emergency call again." },
      { name: "Smart Dispatch & Scheduling", desc: "Fills your calendar, clusters jobs by route, sends arrival texts, follows up on unsold quotes." },
      { name: "Review Engine", desc: "Texts happy customers for Google reviews; routes unhappy ones to you privately first." },
    ],
  },
  {
    id: "clinic",
    label: "Clinics & dental",
    icon: CalendarClock,
    pipelines: [
      { name: "AI Appointment Scheduler", desc: "Books, confirms, reschedules, fills cancellations — voice + SMS, 24/7, any language." },
      { name: "Patient Intake Automation", desc: "Forms, insurance verification, reminders — handled before the patient walks in." },
      { name: "Recall Engine", desc: "Finds patients who haven't booked in 6+ months and brings them back automatically." },
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise & pharma",
    icon: Users,
    pipelines: [
      { name: "ATS Resume Screener", desc: "Reads every resume, scores against the role, surfaces the top 5%. Hiring in days, not months." },
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
      { name: "Deadline Guard", desc: "Tracks every matter's calendar and escalates early. Never miss a filing." },
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
          The same AI systems that multiply output up to 5x
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Your free audit detects your business type and shows which of these systems fit you — with honest math on the upside.
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
            <strong>The 500% math:</strong> one AI voice agent handles the call volume of 3–5 receptionists, 24/7, at a fraction of one salary. The full $5 report shows your exact numbers.
          </p>
        </div>
      </div>
    </section>
  );
}
