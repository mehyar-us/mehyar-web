import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { blogPosts } from "@/data/blog-posts";
import { projects } from "@/data/portfolio-projects";

const coreRoutes = [
  { label: "Home", href: "/", description: "The revenue-leak diagnostic journey and fastest path to contact." },
  { label: "$330 Website + Booking Leak Audit", href: "/micro-offer", description: "Focused entry offer for website, booking, missed-call, and follow-up leaks." },
  { label: "Services", href: "/services", description: "Offer ladder, pricing ranges, and delivery approach." },
  { label: "Book a Call", href: "/booking", description: "Service-specific booking request with safe manual scheduling fallback." },
  { label: "Engagement Patterns", href: "/portfolio", description: "Problem patterns MehyarSoft can diagnose, fix, and automate." },
  { label: "Founder Story", href: "/about", description: "MehyarSoft credibility, values, and founder-led operating context." },
  { label: "Blog", href: "/blog", description: "Practical notes on follow-up, CRM, automation, and consulting decisions." },
  { label: "Free AI Automation Checklist", href: "/newsletter", description: "Newsletter/signup funnel for the free checklist and practical automation updates." },
  { label: "Contact", href: "/contact", description: "Secure intake for audits, cleanup, automations, and systems consulting." },
  { label: "Privacy Policy", href: "/privacy-policy", description: "How contact requests, analytics, and opt-out handling work." },
  { label: "Terms", href: "/terms", description: "Website terms and engagement boundaries." },
];

const detailRoutes = [
  ...projects.map((project) => ({ label: project.title, href: `/portfolio/${project.id}`, description: project.description })),
  ...blogPosts.map((post) => ({ label: post.title, href: `/blog/${post.slug}`, description: post.excerpt })),
];

const Sitemap = () => {
  return (
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Route directory</p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">Sitemap</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">Public MehyarSoft pages only. Owner-only admin, API, test, and unsubscribe utility routes are intentionally excluded from this indexable directory.</p>
        </div>

        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white">Core pages</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {coreRoutes.map((route) => (
              <Link key={route.href} href={route.href} className="group rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35">
                <span className="flex items-center justify-between gap-3 font-semibold text-foreground">
                  {route.label}
                  <ArrowRight className="h-4 w-4 text-brand-700 transition group-hover:translate-x-0.5 dark:text-brand-100" aria-hidden="true" />
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted-foreground">{route.description}</span>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white">Indexable detail pages</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {detailRoutes.map((route) => (
              <Link key={route.href} href={route.href} className="group rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35">
                <span className="flex items-center justify-between gap-3 font-semibold text-foreground">
                  {route.label}
                  <ArrowRight className="h-4 w-4 text-brand-700 transition group-hover:translate-x-0.5 dark:text-brand-100" aria-hidden="true" />
                </span>
                <span className="mt-2 block text-sm leading-6 text-muted-foreground">{route.description}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Sitemap;
