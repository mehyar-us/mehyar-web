import { useEffect } from "react";

const PrivacyPolicy = () => {
  useEffect(() => {
    document.title = "Privacy Policy | MehyarSoft";
  }, []);

  return (
    <section className="pt-28 pb-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary mb-3">MehyarSoft LLC</p>
        <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">Privacy Policy</h1>
        <p className="text-neutral-700 dark:text-neutral-300 mb-8">Last updated May 11, 2026.</p>

        <div className="space-y-8 text-neutral-700 dark:text-neutral-300 leading-relaxed">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">What we collect</h2>
            <p>When you contact MehyarSoft, you may choose to provide your name, email address, company, website, business context, and the problem you want help solving. Do not submit regulated, sensitive, patient, financial, or confidential data through public contact paths.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">How we use it</h2>
            <p>Contact information is used to respond to consulting requests, scope potential work, maintain basic business records, and honor opt-out or suppression requests. MehyarSoft does not sell contact submissions.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Email and follow-up</h2>
            <p>If you request help, MehyarSoft may reply by email about that request. You can ask not to be contacted again, and that preference should be recorded before any further outreach.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Analytics</h2>
            <p>The site may use privacy-conscious analytics to understand aggregate traffic and improve pages. Analytics should not be used to collect secret values or sensitive business information.</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">Contact</h2>
            <p>Questions or privacy requests can be sent to info@mehyar.us.</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PrivacyPolicy;
