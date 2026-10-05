import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
export default function CTASection() {
  return (
    <section className="bg-secondary px-4 py-14">
      <div className="site-shell">
        <h2 className="text-3xl font-semibold tracking-tight">
          What could work better in your business?
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
          Bring one workflow and the tools involved. We will review the fit and
          recommend a next step.
        </p>
        <Link
          href="/contact"
          className={buttonVariants({
            variant: "cta",
            size: "lg",
            className: "mt-6",
          })}
        >
          Discuss your business
        </Link>
      </div>
    </section>
  );
}
