import ConversionFlow, {
  ConversionFlowMode,
} from "@/components/conversion/ConversionFlow";
type Props = {
  prefill?: { message: string };
  mode?: ConversionFlowMode;
  serviceCategory?: string;
  selectedOffer?: string;
  source?: string;
  campaign?: string;
  title?: string;
  description?: string;
  showIntro?: boolean;
};
export default function ContactSection({
  showIntro = true,
  mode = "contact_general",
  source = "contact_section",
  ...props
}: Props) {
  return (
    <section id="contact" className="scroll-mt-24 px-4 py-8 md:py-12">
      <div className="site-shell grid gap-8 lg:grid-cols-[1.3fr_.7fr]">
        <div>
          {showIntro && (
            <h2 className="mb-5 text-3xl font-semibold">
              Discuss your business.
            </h2>
          )}
          <ConversionFlow mode={mode} source={source} {...props} />
        </div>
        <aside className="space-y-8 lg:pt-5">
          <div>
            <h2 className="text-xl font-semibold">What happens next</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Mehyar reviews your request, checks the fit and replies with a
              practical next step. Any discovery or implementation scope is
              agreed before paid work begins.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold">A short brief is enough</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Describe one workflow, your current tools and what you want to
              improve. Budget and timing are optional. Please keep customer
              records and sensitive data out of this form.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-semibold">Prefer email?</h2>
            <a
              className="mt-3 inline-flex min-h-11 items-center text-brand-700 underline dark:text-brand-100"
              href="mailto:info@mehyar.us"
            >
              info@mehyar.us
            </a>
            <p className="text-sm text-muted-foreground">
              Use email if the security check is unavailable.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
