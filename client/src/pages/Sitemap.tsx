import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { blogPosts } from "@/data/blog-posts";
import { projects } from "@/data/portfolio-projects";
import { industryOffers } from "@/data/industry-offers";

const coreRoutes = [
 {label:"Home",href:"/",description:"Custom AI built around your business."},
 {label:"Ask The Mayor",href:"/explore",description:"A visual AI conversation, saved on your device by choice."},
 {label:"Enterprise",href:"/enterprise",description:"Scoped pilots for larger and regulated teams."},
 {label:"Solutions",href:"/services",description:"Customer response, scheduling and internal operations."},
 {label:"Industries",href:"/industries",description:"Ten business contexts and tailored workflows."},
 {label:"Pricing",href:"/pricing",description:"Scope, costs and ongoing operation."},
 {label:"Work",href:"/portfolio",description:"Illustrative engagement patterns."},
 {label:"About",href:"/about",description:"Founder identity and technical accountability."},
 {label:"Discuss your business",href:"/contact",description:"Send a short inquiry."},
 {label:"Arrange a call",href:"/booking",description:"Calendar availability and scheduling fallback."},
 {label:"Products & labs",href:"/apps",description:"Owned software products."},
 {label:"Insights",href:"/blog",description:"Practical business workflow articles."},
 {label:"Free checklist",href:"/free-checklist",description:"Checklist delivery and optional updates."},
 {label:"Free diagnostic",href:"/audit",description:"An automated public website diagnostic."},
 {label:"Founder-led audit",href:"/micro-offer",description:"$330 review and written action plan."},
 {label:"Privacy",href:"/privacy-policy",description:"Privacy policy."},
 {label:"Terms",href:"/terms",description:"Website terms."},
 {label:"Data deletion",href:"/data-deletion",description:"Deletion request information."},
];

const detailRoutes = [
  ...industryOffers.map((industry) => ({ label: `${industry.shortName} custom AI workflows`, href: `/industries/${industry.id}`, description: industry.description })),
  ...projects.map((project) => ({ label: project.title, href: `/portfolio/${project.id}`, description: project.description })),
  ...blogPosts.map((post) => ({ label: post.title, href: `/blog/${post.slug}`, description: post.excerpt })),
];

const Sitemap = () => {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-5xl">
        <div className="mb-10 max-w-3xl">
          <p className="site-eyebrow mb-3">Route directory</p>
          <h1 className="site-display">Sitemap</h1>
          <p className="site-lede mt-4">Public MehyarSoft pages only. Owner-only admin, API, test, and unsubscribe utility routes are intentionally excluded from this indexable directory.</p>
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
