import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  PhoneCall,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import ContactSection from "@/components/contact-section";
import { cn } from "@/lib/utils";

const MicroOffer = () => {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell max-w-4xl">
          <p className="site-eyebrow">Founder-led discovery · $330</p>
          <h1 className="site-display mt-4">
            A clear plan before a custom build.
          </h1>
          <p className="site-lede mt-5">
            A focused review of your website, inquiry path and current systems,
            followed by a written action plan. This is a founder-led audit,
            separate from the free diagnostic and $5 automated report.
          </p>
          <a
            href="#intake"
            className={buttonVariants({ variant: "cta", size: "lg" }) + " mt-7"}
          >
            Request the $330 audit
          </a>
        </div>
      </section>
      <section className="px-4 pb-12">
        <div className="site-shell max-w-4xl">
          <h2 className="text-2xl font-semibold">What the review covers</h2>
          <ul className="mt-5 list-disc space-y-3 pl-5 text-muted-foreground">
            <li>Website message, mobile journey and inquiry path.</li>
            <li>Booking, follow-up and the tools your team uses.</li>
            <li>
              A written plan identifying the first improvement, possible
              automation and any larger build that needs a separate quote.
            </li>
          </ul>
          <p className="mt-6 leading-7">
            Implementation, platform subscriptions and ongoing support are
            separate. We review fit and confirm the scope before paid work
            begins.
          </p>
        </div>
      </section>
      <div id="intake" className="scroll-mt-24">
        <ContactSection
          mode="offer_330_missed_lead_rescue"
          serviceCategory="ai_missed_lead_rescue_330"
          selectedOffer="ai_missed_lead_rescue_330"
          source="330_micro_offer"
          campaign="330_micro_offer"
          showIntro={false}
        />
      </div>
    </>
  );
};
export default MicroOffer;
