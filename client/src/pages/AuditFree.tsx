import AuditWidget from "@/components/AuditWidget";

export default function AuditFree() {
  return (
    <section className="site-hero px-4">
      <div className="site-shell max-w-3xl text-center">
        <p className="site-eyebrow mb-4">Free instant website audit</p>
        <h1 className="site-display text-balance">Is your website leaking money?</h1>
        <p className="site-lede mx-auto mt-4 max-w-2xl text-balance">
          Our scan reads your site like a buyer would — checks every signal, prices every leak in dollars, and maps the AI systems that fit your business, with the capacity math shown for your numbers. Free — about 10 seconds.
        </p>
        <div className="mt-8 text-left">
          <AuditWidget />
        </div>
        <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
          {[["10-second scan", "Score + 3 money leaks, priced in dollars."], ["Your AI upside", "Pipelines for your industry, capacity math shown."], ["Private", "Your report goes to your inbox only."]].map(([t, d]) => (
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
