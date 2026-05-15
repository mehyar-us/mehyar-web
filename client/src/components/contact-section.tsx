import { CheckCircle2, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ConversionFlow, { ConversionFlowMode } from "@/components/conversion/ConversionFlow";

type ContactSectionProps = {
  mode?: ConversionFlowMode;
  serviceCategory?: string;
  selectedOffer?: string;
  source?: string;
  campaign?: string;
  title?: string;
  description?: string;
};

const includeItems = [
  "Business type and city/service area",
  "Current website, CRM, booking, phone, or email tools",
  "Where customers, money, or staff time are being lost",
  "Urgency and budget range if known",
];

const nextSteps = [
  "Boss reviews the request personally.",
  "You get one practical next step: audit, booking call, larger sprint, or no-fit answer.",
  "If there is no fit, you get a direct no-fit answer.",
];

const trustPoints = [
  "Founder-led review by a senior software, systems, and AI automation consultant.",
  "Built for local businesses and regulated teams that need clean handoffs, not agency theater.",
  "No spam: service follow-up requires consent, and marketing updates stay optional.",
];

const ContactSection = ({
  mode = "contact_general",
  serviceCategory,
  selectedOffer,
  source = "contact_section",
  campaign,
  title,
  description,
}: ContactSectionProps) => {
  const isBooking = mode === "booking_call";
  const isOffer = mode === "offer_330_missed_lead_rescue";

  return (
    <section id="contact" className="scroll-mt-24 bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_32%),linear-gradient(180deg,#fff_0%,hsl(var(--background))_100%)] px-4 py-14 dark:bg-[radial-gradient(circle_at_top_left,rgba(102,210,235,0.10),transparent_32%),linear-gradient(180deg,hsl(var(--brand-900))_0%,hsl(var(--background))_100%)] sm:py-20">
      <div className="container mx-auto">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-100">
            {isBooking ? "Manual-safe booking" : isOffer ? "$330 rescue intake" : "Founder-led intake"}
          </p>
          <h2 className="mb-4 text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-5xl">
            {isBooking ? "Request a consulting call without fake availability." : isOffer ? "Start the $330 missed-lead rescue path." : "Request a tech audit or consulting call."}
          </h2>
          <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground">
            {isBooking
              ? "Choose the closest service and preferred window. If calendar auth is unavailable, MehyarSoft captures a manual scheduling request instead of pretending a slot exists."
              : "Describe the leak: bad website flow, missed calls, manual follow-up, disconnected systems, or work your team keeps doing by hand."}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
          <ConversionFlow
            mode={mode}
            serviceCategory={serviceCategory}
            selectedOffer={selectedOffer}
            source={source}
            campaign={campaign}
            title={title}
            description={description}
          />

          <aside className="space-y-6">
            <Card className="border-border bg-card shadow-[0_18px_60px_rgba(8,63,84,0.08)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <CardContent className="p-6">
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">What to include</h3>
                <div className="space-y-3">
                  {includeItems.map((item) => (
                    <div key={item} className="flex gap-3 rounded-2xl bg-brand-100/60 p-3 text-sm leading-6 text-muted-foreground dark:bg-white/[0.04]">
                      <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-brand-700/15 bg-brand-100/55 shadow-none dark:border-white/10 dark:bg-white/[0.04]">
              <CardContent className="p-6">
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">What happens next</h3>
                <div className="mb-5 space-y-3">
                  {nextSteps.map((step, index) => (
                    <div key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-800 text-xs font-bold text-white dark:bg-brand-100 dark:text-brand-950">{index + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
                <h3 className="mb-4 text-xl font-semibold text-ink dark:text-white">Why this form is specific</h3>
                <div className="space-y-4">
                  {trustPoints.map((point) => (
                    <p key={point} className="text-sm leading-6 text-muted-foreground">{point}</p>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-start rounded-2xl border border-border bg-card p-5">
              <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-white/10">
                <Mail className="text-brand-700 dark:text-brand-100" size={18} aria-hidden="true" />
              </div>
              <div className="ml-4">
                <h4 className="font-semibold text-ink dark:text-white">Email fallback</h4>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">If the security check fails, send the same short brief directly.</p>
                <a href="mailto:contact@mehyar.us" className="mt-2 inline-flex text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                  contact@mehyar.us
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
