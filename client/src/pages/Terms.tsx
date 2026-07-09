
const sections = [
  ["Website information", "This website describes MehyarSoft consulting services and does not create a client relationship, guarantee results, or replace a signed statement of work."],
  ["Engagements", "Any paid engagement should be scoped separately with deliverables, timeline, assumptions, access needs, pricing, and responsibilities. Regulated or sensitive environments may require additional controls before work begins."],
  ["No sensitive submissions", "Do not submit passwords, API keys, protected health information, payment data, or other confidential information through public forms or email unless a private intake channel has been agreed in advance."],
  ["Contact", "Questions can be sent to info@mehyar.us."],
];

const Terms = () => {
  return (
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">MehyarSoft LLC</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Terms of Service</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Last updated May 11, 2026. These terms keep website browsing and paid consulting engagement boundaries separate.</p>
        </div>
        <div className="space-y-4">
          {sections.map(([title, body]) => (
            <article key={title} className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-6">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
              <p className="mt-3 leading-7 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Terms;
