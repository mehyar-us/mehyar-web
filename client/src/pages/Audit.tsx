import AuditWidget from "@/components/AuditWidget";

export default function Audit() {
  return (
    <section className="site-hero px-4">
      <div className="site-shell max-w-3xl text-center">
        <p className="site-eyebrow mb-4">Free AI website audit</p>
        <h1 className="site-display text-balance">Find improvements to your website.</h1>
        <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">
          An automated diagnostic of your public website with suggested improvements. This is a starting point, not a founder-led review or a custom implementation quote. Financial and capacity estimates are illustrative scenarios.
        </p>
        <div className="mt-8 text-left">
          <AuditWidget />
        </div>
        <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
          {[["Automated review", "Website observations and suggested next steps."], ["Workflow ideas", "Examples to consider, not promised outcomes."], ["Optional paid report", "A fuller automated report costs $5."]].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">{t}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
