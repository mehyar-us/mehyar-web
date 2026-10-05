import { useExplorer } from "@/components/VisualExplorer";
import ContactSection from "@/components/contact-section";
import type { ConversionFlowMode } from "@/components/conversion/ConversionFlow";
import { useSearch } from "wouter";

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

  if (requestType === "booking") {
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
    serviceCategory: service,
    selectedOffer: offer,
    source: params.get("source") || params.get("utm_source") || "contact_page",
    campaign,
  };
};

const Contact = () => {
  const search = useSearch();
  const { brief, setBrief } = useExplorer();
  const conversionDefaults = getContactQueryDefaults();

  return (
    <>
      <section className="px-4 pb-4 pt-28">
        <div className="site-shell">
          <p className="site-eyebrow">Start a conversation</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl">
            Discuss your business.
          </h1>
          <p className="mt-5 max-w-2xl text-muted-foreground">
            Tell us about one workflow, the tools involved and what you want to
            improve. We will review the fit and recommend a next step.
          </p>
        </div>
      </section>
      {brief && (
        <div className="site-shell px-4">
          <p className="text-sm">
            Your exploration brief is included below. Review and edit it before
            sending.
          </p>
          <button className="min-h-11 underline" onClick={() => setBrief("")}>
            Remove exploration brief
          </button>
        </div>
      )}
      <ContactSection
        key={search + brief}
        {...conversionDefaults}
        prefill={brief ? { message: brief } : undefined}
        showIntro={false}
      />
    </>
  );
};
export default Contact;
