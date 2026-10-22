import AuditWidget from "@/components/AuditWidget";

export default function Audit() {
  return (
    <section className="site-hero px-4">
      <div className="site-shell max-w-3xl text-center">
        <p className="site-eyebrow mb-4">Free AI website audit</p>
        <h1 className="site-display text-balance">Is your website leaking money?</h1>
        <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">
          Our AI scans your site like a buyer would — criticizes every bit, prices every leak in dollars, and maps the AI systems that can multiply your output up to 5x. Free, 60 seconds.
        </p>
        <div className="mt-8 text-left">
          <AuditWidget />
        </div>
        <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
          {[["60-second scan", "Score + 3 money leaks, priced in dollars."], ["Your AI upside", "Pipelines for your industry, 5x math shown."], ["Private", "Your report goes to your inbox only."]].map(([t, d]) => (
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
