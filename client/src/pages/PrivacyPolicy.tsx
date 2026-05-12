import { useEffect } from "react";

const sections = [
  ["What we collect", "When you contact MehyarSoft, you may choose to provide your name, email address, company, website, business context, and the problem you want help solving. Do not submit regulated, sensitive, patient, financial, or confidential data through public contact paths."],
  ["How we use it", "Contact information is used to respond to consulting requests, scope potential work, maintain basic business records, and honor opt-out or suppression requests. MehyarSoft does not sell contact submissions."],
  ["Email and follow-up", "If you request help, MehyarSoft may reply by email about that request. You can ask not to be contacted again, and that preference should be recorded before any further outreach."],
  ["Analytics", "The site may use privacy-conscious analytics to understand aggregate traffic and improve pages. Analytics should not be used to collect secret values or sensitive business information."],
  ["Contact", "Questions or privacy requests can be sent to info@mehyar.us."],
];

const PrivacyPolicy = () => {
  useEffect(() => {
    document.title = "Privacy Policy | MehyarSoft";
  }, []);

  return (
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">MehyarSoft LLC</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Privacy Policy</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Last updated May 11, 2026. This page is intentionally plain-language and owner-safe.</p>
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

export default PrivacyPolicy;
