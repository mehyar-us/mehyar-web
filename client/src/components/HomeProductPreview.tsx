import { useState } from "react";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Inbox,
  LayoutDashboard,
  Search,
  Settings2,
  Sparkles,
  UsersRound,
  Workflow,
} from "lucide-react";

const views = {
  today: {
    label: "Today",
    title: "Today at a glance",
    subtitle: "Bookings, requests, and follow-up in one place.",
    appointments: [
      ["10:00", "New client consultation", "Confirmed"],
      ["11:30", "Service appointment", "Confirmed"],
      ["2:00", "Estimate follow-up", "Needs reply"],
    ],
    prompt: "What needs my attention today?",
    answer: "Two new requests need a reply. Your 2:00 estimate is still open, and three follow-ups are ready for approval.",
  },
  customers: {
    label: "Customers",
    title: "Every customer, remembered",
    subtitle: "See the relationship, not another disconnected inbox.",
    appointments: [
      ["New", "Website request · Maya R.", "Qualified"],
      ["Active", "Project update · Jordan K.", "In progress"],
      ["Return", "Maintenance · Alex P.", "Ready"],
    ],
    prompt: "Who should we follow up with?",
    answer: "Four warm leads have not heard back in 24 hours. I drafted personal replies using their original requests.",
  },
  automations: {
    label: "Automations",
    title: "Routine work keeps moving",
    subtitle: "Simple rules, visible status, and human approval.",
    appointments: [
      ["Live", "Appointment reminders", "Running"],
      ["Live", "New lead routing", "Running"],
      ["Review", "Weekly owner summary", "Approve"],
    ],
    prompt: "What ran while I was away?",
    answer: "Seven reminders were sent, three new leads were organized, and one sensitive reply is waiting for your approval.",
  },
} as const;

type ViewKey = keyof typeof views;

const nav = [
  [LayoutDashboard, "Overview"],
  [CalendarDays, "Schedule"],
  [Inbox, "Requests"],
  [UsersRound, "Customers"],
  [Workflow, "Workflows"],
] as const;

export default function HomeProductPreview() {
  const [active, setActive] = useState<ViewKey>("today");
  const view = views[active];

  return (
    <div className="overflow-hidden border border-brand-900/12 bg-white shadow-[0_24px_70px_rgba(6,47,66,0.14)] dark:border-white/10 dark:bg-brand-950" aria-label="Interactive operations dashboard preview">
      <div className="flex h-12 items-center justify-between border-b border-border px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <span className="grid h-7 w-7 shrink-0 place-items-center bg-brand-950 text-white dark:bg-white dark:text-brand-950"><LayoutDashboard className="h-3.5 w-3.5" /></span>
          <span className="truncate">Your operations</span>
        </div>
        <div className="hidden min-w-0 items-center gap-2 border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          <Search className="h-3.5 w-3.5" /><span className="truncate">Search customers, requests, appointments…</span>
        </div>
        <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="grid min-h-[360px] grid-cols-1 sm:grid-cols-[118px_1fr] lg:min-h-[430px] lg:grid-cols-[132px_minmax(0,1fr)_220px]">
        <aside className="hidden border-r border-border bg-muted/25 p-2 sm:flex sm:flex-col">
          <div className="space-y-1">
            {nav.map(([Icon, label], index) => (
              <div key={label} className={`flex items-center gap-2 px-2 py-2 text-[0.72rem] font-medium ${index === 0 ? "bg-secondary text-brand-950 dark:bg-white/10 dark:text-white" : "text-muted-foreground"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-2 px-2 py-2 text-[0.68rem] text-muted-foreground"><CircleDot className="h-3 w-3 fill-emerald-500 text-emerald-500" />All systems ready</div>
        </aside>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-foreground">{view.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{view.subtitle}</p>
            </div>
            <div className="flex border border-border bg-muted/25 p-0.5" role="tablist" aria-label="Dashboard preview">
              {(Object.keys(views) as ViewKey[]).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => setActive(key)} className={`min-h-8 px-2.5 text-[0.68rem] font-semibold transition ${active === key ? "bg-white text-brand-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {views[key].label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold"><CalendarDays className="h-3.5 w-3.5 text-brand-700" />Activity</span>
              <span className="text-[0.66rem] font-medium text-brand-700">View all</span>
            </div>
            <div className="divide-y divide-border">
              {view.appointments.map(([time, label, status]) => (
                <div key={`${time}-${label}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 text-[0.7rem]">
                  <span className="font-medium text-muted-foreground">{time}</span>
                  <span className="truncate font-medium text-foreground">{label}</span>
                  <span className="inline-flex items-center gap-1 text-[0.62rem] font-semibold text-brand-700"><CheckCircle2 className="h-3 w-3" />{status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 divide-x divide-border border border-border bg-muted/20 py-3 text-center">
            <div><p className="text-lg font-semibold text-foreground">8</p><p className="text-[0.62rem] text-muted-foreground">new requests</p></div>
            <div><p className="text-lg font-semibold text-foreground">3</p><p className="text-[0.62rem] text-muted-foreground">follow-ups</p></div>
            <div><p className="text-lg font-semibold text-foreground">1</p><p className="text-[0.62rem] text-muted-foreground">needs approval</p></div>
          </div>

          <div className="mt-3 border border-brand-700/20 bg-secondary/55 p-3 lg:hidden">
            <p className="flex items-center gap-2 text-[0.68rem] font-semibold text-brand-900 dark:text-brand-100"><Sparkles className="h-3.5 w-3.5" />AI assistant</p>
            <p className="mt-2 text-xs font-medium text-foreground">“{view.prompt}”</p>
            <p className="mt-1 text-[0.68rem] leading-5 text-muted-foreground">{view.answer}</p>
          </div>
        </div>

        <aside className="hidden border-l border-border p-4 lg:block">
          <p className="flex items-center gap-2 text-xs font-semibold text-foreground"><Bot className="h-4 w-4 text-brand-700" />AI assistant</p>
          <div className="mt-5 bg-muted/55 p-3 text-[0.68rem] leading-5 text-foreground">{view.prompt}</div>
          <div className="mt-3 border border-brand-700/20 bg-secondary/55 p-3">
            <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold text-brand-800 dark:text-brand-100"><Sparkles className="h-3 w-3" />Ready for you</p>
            <p className="mt-2 text-[0.68rem] leading-5 text-muted-foreground">{view.answer}</p>
          </div>
          <button type="button" className="mt-4 flex w-full items-center justify-between border-t border-border py-3 text-left text-[0.68rem] font-semibold text-brand-800 dark:text-brand-100">Open command center<ChevronRight className="h-3.5 w-3.5" /></button>
        </aside>
      </div>
    </div>
  );
}
