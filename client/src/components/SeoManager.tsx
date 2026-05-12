import { useEffect } from "react";
import { useLocation } from "wouter";

const SITE_ORIGIN = "https://mehyar.us";

const routeMeta: Record<string, { title: string; description: string; robots?: string; canonical?: string }> = {
  "/": {
    title: "MehyarSoft LLC - Senior Systems, Software & AI Automation Consultant",
    description: "Founder-led software, systems, and AI automation consulting for local and regulated businesses losing customers to missed calls, weak websites, manual work, and disconnected tools.",
  },
  "/services": {
    title: "Services & Pricing | MehyarSoft",
    description: "Consulting offers for business audits, website cleanup, missed-call follow-up, automation sprints, integrations, architecture support, and retainers.",
  },
  "/portfolio": {
    title: "Engagement Patterns | MehyarSoft",
    description: "Honest MehyarSoft engagement patterns for customer leaks, follow-up systems, automations, integrations, and practical business software work.",
  },
  "/blog": {
    title: "Blog | MehyarSoft",
    description: "Practical notes on local business tech audits, CRM follow-up, automation, and when custom software is worth it.",
  },
  "/about": {
    title: "Founder Story | MehyarSoft",
    description: "MehyarSoft is founder-led consulting from Mehyar Swelim, a Syrian founder in NYC with 10+ years professional software engineering experience.",
  },
  "/contact": {
    title: "Contact | MehyarSoft",
    description: "Send a secure MehyarSoft intake request for a tech audit, website cleanup, missed-call follow-up, automation, or systems consulting.",
  },
  "/admin": {
    title: "Admin Metrics | MehyarSoft",
    description: "Owner-only MehyarSoft admin area.",
    robots: "noindex,nofollow,noarchive",
  },
  "/unsubscribe": {
    title: "Unsubscribe | MehyarSoft",
    description: "Unsubscribe from MehyarSoft communications.",
    robots: "noindex,follow",
  },
  "/privacy-policy": {
    title: "Privacy Policy | MehyarSoft",
    description: "MehyarSoft privacy policy for contact requests, analytics, service follow-up, and opt-out handling.",
  },
  "/terms": {
    title: "Terms of Service | MehyarSoft",
    description: "MehyarSoft website terms and engagement boundaries.",
  },
  "/sitemap": {
    title: "Sitemap | MehyarSoft",
    description: "Human-readable route directory for MehyarSoft public pages.",
  },
};

const ensureMeta = (selector: string, create: () => HTMLMetaElement | HTMLLinkElement) => {
  const existing = document.head.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
  if (existing) return existing;
  const element = create();
  document.head.appendChild(element);
  return element;
};

const resolveRoute = (path: string) => {
  const barePath = path.split("?")[0].replace(/\/$/, "") || "/";

  if (routeMeta[barePath]) {
    return { metaKey: barePath, canonicalPath: routeMeta[barePath].canonical ?? barePath };
  }

  if (barePath.startsWith("/portfolio/")) {
    return { metaKey: "/portfolio", canonicalPath: barePath };
  }

  if (barePath.startsWith("/blog/")) {
    return { metaKey: "/blog", canonicalPath: barePath };
  }

  return { metaKey: "__404", canonicalPath: "/404" };
};

export default function SeoManager() {
  const [location] = useLocation();

  useEffect(() => {
    const resolved = resolveRoute(location);
    const meta = routeMeta[resolved.metaKey] ?? {
      title: "404 Page Not Found | MehyarSoft",
      description: "This MehyarSoft page could not be found.",
      robots: "noindex,follow",
    };
    const canonicalPath = resolved.canonicalPath;
    const canonicalUrl = `${SITE_ORIGIN}${canonicalPath === "/" ? "/" : canonicalPath}`;

    document.title = meta.title;

    const description = ensureMeta('meta[name="description"]', () => {
      const tag = document.createElement("meta");
      tag.setAttribute("name", "description");
      return tag;
    }) as HTMLMetaElement;
    description.setAttribute("content", meta.description);

    const robots = ensureMeta('meta[name="robots"]', () => {
      const tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      return tag;
    }) as HTMLMetaElement;
    robots.setAttribute("content", meta.robots ?? "index,follow");

    const canonical = ensureMeta('link[rel="canonical"]', () => {
      const tag = document.createElement("link");
      tag.setAttribute("rel", "canonical");
      return tag;
    }) as HTMLLinkElement;
    canonical.setAttribute("href", canonicalUrl);

    const ogUrl = ensureMeta('meta[property="og:url"]', () => {
      const tag = document.createElement("meta");
      tag.setAttribute("property", "og:url");
      return tag;
    }) as HTMLMetaElement;
    ogUrl.setAttribute("content", canonicalUrl);

    const ogTitle = ensureMeta('meta[property="og:title"]', () => {
      const tag = document.createElement("meta");
      tag.setAttribute("property", "og:title");
      return tag;
    }) as HTMLMetaElement;
    ogTitle.setAttribute("content", meta.title);

    const ogDescription = ensureMeta('meta[property="og:description"]', () => {
      const tag = document.createElement("meta");
      tag.setAttribute("property", "og:description");
      return tag;
    }) as HTMLMetaElement;
    ogDescription.setAttribute("content", meta.description);
  }, [location]);

  return null;
}
