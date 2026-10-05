import { Link } from "wouter";
import { buttonVariants } from "@/components/ui/button";
export default function ProposalsDirectory() {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-3xl">
        <p className="site-eyebrow">Client utility</p>
        <h1 className="site-display mt-4">Client proposals</h1>
        <p className="site-lede mt-5">
          Open the specific proposal link shared with you. Client proposals are
          not listed in a public directory.
        </p>
        <Link
          href="/contact"
          className={buttonVariants({ variant: "cta", size: "lg" }) + " mt-7"}
        >
          Discuss your business
        </Link>
      </div>
    </section>
  );
}
