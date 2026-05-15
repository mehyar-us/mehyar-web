import ContactSection from "@/components/contact-section";
import QuickAnswer from "@/components/QuickAnswer";
import type { ConversionFlowMode } from "@/components/conversion/ConversionFlow";

const getContactQueryDefaults = (): { mode: ConversionFlowMode; serviceCategory?: string; source: string; campaign?: string } => {
  if (typeof window === "undefined") return { mode: "contact_general", source: "contact_page" };

  const params = new URLSearchParams(window.location.search);
  const service = params.get("service")?.trim() || undefined;
  const requestType = params.get("request_type")?.trim() || undefined;
  const campaign = params.get("utm_campaign")?.trim() || undefined;

  const normalizedService = service?.replace(/-/g, "_");

  if (requestType === "micro_offer" || normalizedService === "ai_missed_lead_rescue_330" || service === "330" || service === "micro-offer") {
    return {
      mode: "offer_330_missed_lead_rescue",
      serviceCategory: "ai_missed_lead_rescue_330",
      source: "contact_query_offer",
      campaign,
    };
  }

  if (service) {
    return {
      mode: "booking_call",
      serviceCategory: service,
      source: "contact_query_booking",
      campaign,
    };
  }

  return { mode: "contact_general", source: "contact_page", campaign };
};

const Contact = () => {
  const conversionDefaults = getContactQueryDefaults();

  return (
    <>
      <section className="px-4 pb-16 pt-28 sm:pb-20 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">Secure intake</p>
          <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-bold tracking-tight text-neutral-900 dark:text-white md:text-6xl">
            Tell me where the business is leaking.
          </h1>
          <p className="mx-auto max-w-3xl text-lg leading-8 text-neutral-700 dark:text-neutral-300 md:text-xl">
            Send the current problem, the tools involved, and what a win would look like. If an audit is the right first step, I will say that before recommending a larger build.
          </p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 text-sm font-medium text-neutral-700 dark:text-neutral-300 sm:flex-row sm:justify-center">
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">No passwords or private records</span>
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">Cloudflare protected</span>
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">Founder-reviewed next step</span>
          </div>
        </div>
      </section>
      <QuickAnswer
        question="How do I contact MehyarSoft?"
        answer="Use this MehyarSoft contact page or email info@mehyar.us with your business type, current workflow problem, tools involved, timeline, and budget range if known. Do not send passwords, API keys, PHI, payment data, or confidential files through public channels."
      />
      <ContactSection {...conversionDefaults} />
    </>
  );
};

export default Contact;
