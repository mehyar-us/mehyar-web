import { useEffect } from "react";

const Terms = () => {
  useEffect(() => {
    document.title = "Terms | MehyarSoft";
  }, []);

  return (
    <section className="pt-28 pb-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary mb-3">MehyarSoft LLC</p>
        <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">Terms of Service</h1>
        <p className="text-neutral-700 dark:text-neutral-300 mb-8">Last updated May 11, 2026.</p>

        <div className="space-y-8 text-neutral-700 dark:text-neutral-300 leading-relaxed">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Website information</h2>
            <p>This website describes MehyarSoft consulting services and does not create a client relationship, guarantee results, or replace a signed statement of work.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Engagements</h2>
            <p>Any paid engagement should be scoped separately with deliverables, timeline, assumptions, access needs, pricing, and responsibilities. Regulated or sensitive environments may require additional controls before work begins.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">No sensitive submissions</h2>
            <p>Do not submit passwords, API keys, protected health information, payment data, or other confidential information through public forms or email unless a secure intake path has been agreed in advance.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Contact</h2>
            <p>Questions can be sent to info@mehyar.us.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Terms;
