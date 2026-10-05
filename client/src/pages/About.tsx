import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
import CTASection from "@/components/cta-section";
export default function About() {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell grid gap-10 lg:grid-cols-[1.2fr_.8fr]">
          <div>
            <p className="site-eyebrow">Founder-led engineering</p>
            <h1 className="site-display mt-4">Meet Mehyar Swelim.</h1>
            <p className="site-lede mt-5">
              A Syrian founder in New York City with 10+ years of professional
              software engineering experience. MehyarSoft brings that experience
              to custom AI systems shaped around each business.
            </p>
            <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
              My work spans applications, systems and integrations. The starting
              point is how your team actually works: the information you trust,
              the tools you already use and the decisions that need a person.
            </p>
            <Link
              href="/contact"
              className={
                buttonVariants({ variant: "cta", size: "lg" }) + " mt-7"
              }
            >
              Discuss your business
            </Link>
          </div>
          <aside className="border-t border-border pt-6 lg:mt-4">
            <img
              src="/assets/mehyarsoft-mark-new-192.png"
              alt="MehyarSoft"
              width="96"
              height="96"
              className="h-24 w-24 object-contain"
            />
            <h2 className="mt-6 text-2xl font-semibold">
              Direct technical accountability
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              You discuss the workflow with the person responsible for the
              implementation. Scope, integration boundaries and support
              responsibilities are explained before the build.
            </p>
          </aside>
        </div>
      </section>
      <section className="border-t px-4 py-14">
        <div className="site-shell">
          <h2 className="text-3xl font-semibold">How I approach the work</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {[
              [
                "Start with the task",
                "Define one useful workflow, the people involved and what a successful handoff looks like.",
              ],
              [
                "Build with control",
                "Use approved information and appropriate permissions. Test the workflow and keep human review where it matters.",
              ],
              [
                "Make it maintainable",
                "Explain how the system operates, what it costs to run and which changes or support need an agreed scope.",
              ],
            ].map(([title, copy]) => (
              <article key={title} className="border-t pt-5">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-4 leading-7 text-muted-foreground">{copy}</p>
              </article>
            ))}
          </div>
          <Link
            href="/portfolio"
            className="mt-8 inline-flex min-h-11 items-center font-semibold underline"
          >
            Explore illustrative work patterns
          </Link>
        </div>
      </section>
      <CTASection />
    </>
  );
}
