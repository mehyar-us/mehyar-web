import { useEffect } from "react";
import { useLocation } from "wouter";
import { blogPosts } from "@/data/blog-posts";
import { projects } from "@/data/portfolio-projects";
import { services } from "@/data/services";

const SITE_ORIGIN = "https://mehyar.us";
const SITE_NAME = "MehyarSoft LLC";
const SOCIAL_IMAGE = `${SITE_ORIGIN}/assets/mehyarsoft-social.svg`;

interface SeoMeta {
  title: string;
  description: string;
  path: string;
  robots?: string;
  type?: "website" | "article";
  jsonLd?: Record<string, unknown>[];
}

const absoluteUrl = (path: string) => `${SITE_ORIGIN}${path === "/" ? "/" : path}`;

const organization = {
  "@type": "Organization",
  "@id": `${SITE_ORIGIN}/#organization`,
  name: SITE_NAME,
  legalName: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  logo: `${SITE_ORIGIN}/assets/mehyarsoft-mark.png`,
  email: "info@mehyar.us",
  founder: { "@type": "Person", name: "Mehyar Swelim" },
};

const professionalService = {
  "@type": "ProfessionalService",
  "@id": `${SITE_ORIGIN}/#professional-service`,
  name: SITE_NAME,
  legalName: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  email: "info@mehyar.us",
  founder: { "@type": "Person", name: "Mehyar Swelim" },
  areaServed: ["New York City", "New York", "United States", "Remote US"],
  priceRange: "$150-$25,000+",
  knowsAbout: [
    "software consulting",
    "systems engineering",
    "AI automation",
    "CRM workflows",
    "web development",
    "systems integration",
    "DevOps",
  ],
};

const website = {
  "@type": "WebSite",
  "@id": `${SITE_ORIGIN}/#website`,
  name: "MehyarSoft",
  url: `${SITE_ORIGIN}/`,
  publisher: { "@id": `${SITE_ORIGIN}/#organization` },
};

const webPage = (path: string, title: string, description: string, type = "WebPage") => ({
  "@type": type,
  "@id": `${absoluteUrl(path)}#webpage`,
  url: absoluteUrl(path),
  name: title,
  description,
  isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
  about: { "@id": `${SITE_ORIGIN}/#professional-service` },
});

const breadcrumbs = (items: { name: string; path: string }[]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});

const faq = (items: { question: string; answer: string }[]) => ({
  "@type": "FAQPage",
  mainEntity: items.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
});

const offerCatalog = {
  "@type": "OfferCatalog",
  name: "MehyarSoft consulting services",
  itemListElement: services.map((service) => {
    const range = service.features.find((feature) => feature.toLowerCase().includes("typical range"));

    return {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: service.title,
        description: service.description,
        provider: { "@id": `${SITE_ORIGIN}/#professional-service` },
        areaServed: ["New York City", "New York", "United States", "Remote US"],
      },
      ...(range
        ? {
            priceSpecification: {
              "@type": "PriceSpecification",
              priceCurrency: "USD",
              description: range,
            },
          }
        : {}),
      url: `${absoluteUrl("/services")}#${service.id}`,
    };
  }),
};

const staticMeta: Record<string, SeoMeta> = {
  "/": {
    title: "MehyarSoft LLC | NYC Software & AI Automation Consultant",
    description:
      "Founder-led software, systems, and AI automation consulting for local businesses and regulated teams losing leads to missed calls, weak websites, manual follow-up, and disconnected tools.",
    path: "/",
    jsonLd: [organization, professionalService, website, webPage("/", "MehyarSoft LLC | NYC Software & AI Automation Consultant", "Founder-led software, systems, and AI automation consulting for local businesses and regulated teams."), offerCatalog],
  },
  "/services": {
    title: "Services & Pricing | MehyarSoft Software Automation Consulting",
    description:
      "Explore MehyarSoft consulting offers: local business tech audits, website and booking cleanup, missed-call follow-up flows, internal automation sprints, systems integration, retainers, and custom software builds.",
    path: "/services",
    jsonLd: [webPage("/services", "Services & Pricing | MehyarSoft Software Automation Consulting", "MehyarSoft consulting offers for audits, cleanup, missed-call follow-up, automation, integrations, retainers, and custom software."), breadcrumbs([{ name: "Home", path: "/" }, { name: "Services", path: "/services" }]), offerCatalog, faq([
      { question: "What consulting services does MehyarSoft offer?", answer: "MehyarSoft LLC offers practical tech audits, website and booking cleanup, consent-safe missed-call follow-up flows, internal automation sprints, systems integration consulting, support retainers, and custom software builds." },
      { question: "What is a local business tech audit?", answer: "A local business tech audit reviews the public website, booking path, phone and email response, CRM or spreadsheet use, and manual admin bottlenecks to find the highest-value fixes before adding more tools." },
      { question: "What is a missed-call follow-up flow?", answer: "A missed-call follow-up flow turns inbound intent into a lead record, owner notification, and consent-aware SMS or email response with opt-out and suppression planning before scale." },
      { question: "When should a business build custom software?", answer: "Custom software makes sense when the workflow is stable, repeated, important, and constrained by off-the-shelf tools that create more manual work than they remove." },
    ])],
  },
  "/portfolio": {
    title: "Engagement Patterns | MehyarSoft Consulting Work Examples",
    description:
      "Review MehyarSoft engagement patterns for lead leak audits, missed-call follow-up, internal automation, regulated systems integration, website cleanup, and support retainers.",
    path: "/portfolio",
    jsonLd: [webPage("/portfolio", "Engagement Patterns | MehyarSoft Consulting Work Examples", "Reference engagement patterns for MehyarSoft consulting work.", "CollectionPage"), breadcrumbs([{ name: "Home", path: "/" }, { name: "Engagement Patterns", path: "/portfolio" }]), {
      "@type": "ItemList",
      itemListElement: projects.map((project, index) => ({ "@type": "ListItem", position: index + 1, name: project.title, url: absoluteUrl(`/portfolio/${project.id}`) })),
    }, faq([{ question: "Are these MehyarSoft client case studies?", answer: "No. These are reference engagement patterns showing the types of problems MehyarSoft is built to solve. MehyarSoft avoids fake testimonials and fake metrics." }])],
  },
  "/blog": {
    title: "Blog & Insights | MehyarSoft Tech Audit & Automation Notes",
    description:
      "Practical MehyarSoft notes on local business tech audits, missed-call CRM follow-up, internal automation, and when custom software is worth building.",
    path: "/blog",
    jsonLd: [webPage("/blog", "Blog & Insights | MehyarSoft Tech Audit & Automation Notes", "Practical notes on tech audits, follow-up, automation, and custom software decisions.", "Blog"), breadcrumbs([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]), {
      "@type": "ItemList",
      itemListElement: blogPosts.map((post, index) => ({ "@type": "ListItem", position: index + 1, name: post.title, url: absoluteUrl(`/blog/${post.slug}`) })),
    }],
  },
  "/about": {
    title: "Founder Story | MehyarSoft LLC NYC Software Consultant",
    description:
      "Meet Mehyar Swelim, Syrian founder of MehyarSoft LLC in NYC, providing senior software, systems, and AI automation consulting for businesses with practical operational problems.",
    path: "/about",
    jsonLd: [webPage("/about", "Founder Story | MehyarSoft LLC NYC Software Consultant", "Meet Mehyar Swelim, Syrian founder of MehyarSoft LLC in NYC.", "AboutPage"), breadcrumbs([{ name: "Home", path: "/" }, { name: "Founder Story", path: "/about" }]), organization, {
      "@type": "Person",
      name: "Mehyar Swelim",
      jobTitle: "Software, Systems, and AI Automation Consultant",
      affiliation: { "@id": `${SITE_ORIGIN}/#organization` },
      worksFor: { "@id": `${SITE_ORIGIN}/#organization` },
    }, faq([{ question: "Who founded MehyarSoft?", answer: "MehyarSoft LLC was founded by Mehyar Swelim, a Syrian founder in New York City and professional software engineer focused on practical software, systems, and automation consulting." }])],
  },
  "/330": {
    title: "$330 Website + Booking Leak Audit | MehyarSoft",
    description:
      "A focused $330 MehyarSoft audit for local businesses that need a clear diagnosis of website, booking, missed-call, and follow-up leaks before buying more software.",
    path: "/330",
    jsonLd: [webPage("/330", "$330 Website + Booking Leak Audit | MehyarSoft", "Focused $330 audit for website, booking, missed-call, and follow-up leaks."), breadcrumbs([{ name: "Home", path: "/" }, { name: "$330 Audit", path: "/330" }]), {
      "@type": "Service",
      name: "$330 Website + Booking Leak Audit",
      description: "A focused MehyarSoft audit for local businesses that need a clear diagnosis of website, booking, missed-call, and follow-up leaks.",
      provider: { "@id": `${SITE_ORIGIN}/#professional-service` },
      areaServed: ["New York City", "New York", "United States", "Remote US"],
      offers: { "@type": "Offer", price: "330", priceCurrency: "USD", url: absoluteUrl("/330") },
    }],
  },
  "/micro-offer": {
    title: "$330 Website + Booking Leak Audit | MehyarSoft",
    description:
      "A focused $330 MehyarSoft audit for local businesses that need a clear diagnosis of website, booking, missed-call, and follow-up leaks before buying more software.",
    path: "/330",
  },
  "/contact": {
    title: "Contact MehyarSoft | Request a Tech Audit or Consulting Call",
    description:
      "Contact MehyarSoft LLC to request a tech audit, consulting call, website cleanup, CRM follow-up flow, automation sprint, or systems integration review.",
    path: "/contact",
    jsonLd: [webPage("/contact", "Contact MehyarSoft | Request a Tech Audit or Consulting Call", "Contact MehyarSoft LLC to request a practical consulting next step.", "ContactPage"), breadcrumbs([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }]), { ...organization, contactPoint: { "@type": "ContactPoint", email: "info@mehyar.us", contactType: "consulting intake" } }, faq([{ question: "How do I contact MehyarSoft?", answer: "Use the MehyarSoft contact page or email info@mehyar.us with your business type, current workflow problem, tools involved, timeline, and budget range if known. Do not send passwords, API keys, PHI, payment data, or confidential files through public channels." }])],
  },
  "/privacy-policy": {
    title: "Privacy Policy | MehyarSoft LLC",
    description:
      "Read how MehyarSoft LLC handles consulting contact submissions, business context, follow-up, analytics, privacy requests, and sensitive-data cautions.",
    path: "/privacy-policy",
    jsonLd: [webPage("/privacy-policy", "Privacy Policy | MehyarSoft LLC", "MehyarSoft privacy policy for contact requests, analytics, follow-up, and sensitive-data cautions."), breadcrumbs([{ name: "Home", path: "/" }, { name: "Privacy Policy", path: "/privacy-policy" }])],
  },
  "/terms": {
    title: "Terms of Service | MehyarSoft LLC",
    description:
      "Review MehyarSoft LLC website terms covering informational content, consulting engagements, sensitive submissions, and contact instructions.",
    path: "/terms",
    jsonLd: [webPage("/terms", "Terms of Service | MehyarSoft LLC", "MehyarSoft website terms covering informational content, consulting engagement boundaries, and sensitive submissions."), breadcrumbs([{ name: "Home", path: "/" }, { name: "Terms", path: "/terms" }])],
  },
  "/sitemap": {
    title: "Sitemap | MehyarSoft LLC",
    description:
      "Browse MehyarSoft public pages including services, engagement patterns, blog insights, founder story, contact, privacy policy, and terms.",
    path: "/sitemap",
    jsonLd: [webPage("/sitemap", "Sitemap | MehyarSoft LLC", "Human-readable route directory for MehyarSoft public pages."), breadcrumbs([{ name: "Home", path: "/" }, { name: "Sitemap", path: "/sitemap" }])],
  },
  "/unsubscribe": {
    title: "Unsubscribe | MehyarSoft LLC",
    description: "Unsubscribe from MehyarSoft communications.",
    path: "/unsubscribe",
    robots: "noindex,follow",
  },
};

const adminMeta = (path: string): SeoMeta => ({
  title: path.includes("email") ? "Email Command Center | MehyarSoft" : "Admin Metrics | MehyarSoft",
  description: "Owner-only MehyarSoft admin area.",
  path,
  robots: "noindex,nofollow,noarchive",
});

const notFoundMeta = (path: string): SeoMeta => ({
  title: "Page Not Found | MehyarSoft LLC",
  description:
    "The requested MehyarSoft page could not be found. Return to services, engagement patterns, insights, or contact MehyarSoft for consulting help.",
  path,
  robots: "noindex,follow",
});

const resolveMeta = (rawPath: string): SeoMeta => {
  const path = rawPath.split("?")[0].replace(/\/$/, "") || "/";
  if (path.startsWith("/admin")) return adminMeta(path);
  if (staticMeta[path]) return staticMeta[path];

  if (path.startsWith("/portfolio/")) {
    const id = Number(path.replace("/portfolio/", ""));
    const project = projects.find((item) => item.id === id);
    if (!project) return notFoundMeta(path);
    const title = `${project.title} | MehyarSoft Engagement Pattern`;
    const description = `${project.description} Learn the challenge, solution, expected operating outcomes, and when to request a MehyarSoft consulting audit.`;
    return {
      title,
      description,
      path,
      jsonLd: [webPage(path, title, description), breadcrumbs([{ name: "Home", path: "/" }, { name: "Engagement Patterns", path: "/portfolio" }, { name: project.title, path }]), {
        "@type": "Service",
        name: project.title,
        description: project.description,
        provider: { "@id": `${SITE_ORIGIN}/#professional-service` },
        serviceType: project.category,
        areaServed: ["New York City", "New York", "United States", "Remote US"],
        url: absoluteUrl(path),
      }],
    };
  }

  if (path.startsWith("/blog/")) {
    const slug = path.replace("/blog/", "");
    const post = blogPosts.find((item) => item.slug === slug);
    if (!post) return notFoundMeta(path);
    return {
      title: `${post.title} | MehyarSoft Blog`,
      description: post.excerpt,
      path,
      type: "article",
      jsonLd: [{
        "@type": "BlogPosting",
        headline: post.title,
        description: post.excerpt,
        datePublished: post.date,
        dateModified: post.date,
        author: { "@type": "Person", name: post.author },
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
        image: absoluteUrl(post.image),
        mainEntityOfPage: absoluteUrl(path),
      }, breadcrumbs([{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: post.title, path }])],
    };
  }

  return notFoundMeta(path);
};

const ensureElement = <T extends HTMLElement>(selector: string, create: () => T) => {
  const existing = document.head.querySelector(selector) as T | null;
  if (existing) return existing;
  const element = create();
  document.head.appendChild(element);
  return element;
};

const setMeta = (selector: string, attrName: "name" | "property", attrValue: string, content: string) => {
  const tag = ensureElement(selector, () => {
    const element = document.createElement("meta");
    element.setAttribute(attrName, attrValue);
    return element;
  });
  tag.setAttribute("content", content);
};

export default function SeoManager() {
  const [location] = useLocation();

  useEffect(() => {
    const meta = resolveMeta(location);
    const canonicalUrl = absoluteUrl(meta.path);
    const image = SOCIAL_IMAGE;

    document.title = meta.title;
    setMeta('meta[name="description"]', "name", "description", meta.description);
    setMeta('meta[name="robots"]', "name", "robots", meta.robots ?? "index,follow");
    setMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);
    setMeta('meta[property="og:title"]', "property", "og:title", meta.title);
    setMeta('meta[property="og:description"]', "property", "og:description", meta.description);
    setMeta('meta[property="og:type"]', "property", "og:type", meta.type ?? "website");
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:image"]', "property", "og:image", image);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", meta.title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", meta.description);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", image);

    const canonical = ensureElement('link[rel="canonical"]', () => {
      const tag = document.createElement("link");
      tag.setAttribute("rel", "canonical");
      return tag;
    });
    canonical.setAttribute("href", canonicalUrl);

    document.querySelectorAll('script[data-seo-jsonld="route"]').forEach((element) => element.remove());
    if (meta.jsonLd?.length) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seoJsonld = "route";
      script.text = JSON.stringify({ "@context": "https://schema.org", "@graph": meta.jsonLd }, null, 2);
      document.head.appendChild(script);
    }
  }, [location]);

  return null;
}
