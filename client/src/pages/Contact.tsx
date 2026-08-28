import ContactSection from "@/components/contact-section";
import QuickAnswer from "@/components/QuickAnswer";
import type { ConversionFlowMode } from "@/components/conversion/ConversionFlow";
import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";

const getContactQueryDefaults = (): {
  mode: ConversionFlowMode;
  serviceCategory?: string;
  selectedOffer?: string;
  source: string;
  campaign?: string;
} => {
  if (typeof window === "undefined")
    return { mode: "contact_general", source: "contact_page" };

  const params = new URLSearchParams(window.location.search);
  const service = params.get("service")?.trim() || undefined;
  const requestType = params.get("request_type")?.trim() || undefined;
  const campaign = params.get("utm_campaign")?.trim() || undefined;
  const offer = params.get("offer")?.trim() || undefined;

  const normalizedService = service?.replace(/-/g, "_");

  if (
    requestType === "micro_offer" ||
    normalizedService === "ai_missed_lead_rescue_330" ||
    service === "330" ||
    service === "micro-offer"
  ) {
    return {
      mode: "offer_330_missed_lead_rescue",
      serviceCategory: "ai_missed_lead_rescue_330",
      source: "contact_query_offer",
      campaign,
    };
  }

  if (service && !offer) {
    return {
      mode: "booking_call",
      serviceCategory: service,
      selectedOffer: offer,
      source: "contact_query_booking",
      campaign,
    };
  }

  return {
    mode: "contact_general",
    selectedOffer: offer,
    source: "contact_page",
    campaign,
  };
};

const Contact = () => {
  const conversionDefaults = getContactQueryDefaults();

  return (
    <>
      <section className="site-hero">
        <div className="site-shell text-center">
          <p className="site-eyebrow mb-3">
            Send the leak
          </p>
          <h1 className="site-display mx-auto mb-6 max-w-4xl">
            Tell me where the business is leaking.
          </h1>
          <p className="site-lede mx-auto max-w-3xl">
            Pick an industry package first if you can; the selected package
            carries into this one guided request. If you are unsure, send the
            current problem, tools involved, and what a win looks
            like—MehyarSoft will recommend the smallest useful next step.
          </p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className={buttonVariants({ variant: "cta", size: "lg" })}
            >
              Choose industry + price
            </Link>
            <Link
              href="/micro-offer#intake"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Start the $330 audit
            </Link>
            <Link
              href="/booking"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Request a call
            </Link>
          </div>
          <div className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 text-sm font-medium text-neutral-700 dark:text-neutral-300 sm:flex-row sm:justify-center">
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
              No passwords or private records
            </span>
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
              Cloudflare protected
            </span>
            <span className="rounded-full border border-neutral-200 bg-white/80 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950/60">
              Founder-reviewed next step
            </span>
          </div>
        </div>
      </section>
      <QuickAnswer
        question="Which path should I choose?"
        answer="Choose a named package when the result is clear, start with the $330 tech audit when the leak is clear but the fix is not, or use this intake when your business needs a custom combination. Do not send passwords, API keys, PHI, payment data, or confidential files through public channels."
      />
      <ContactSection {...conversionDefaults} showIntro={false} />
    </>
  );
};

export default Contact;
