import { useEffect } from "react";
import { useLocation } from "wouter";
import { resolveMeta, SITE_ORIGIN, SOCIAL_IMAGE } from "@/data/site-seo";
export default function SeoManager() {
  const [location] = useLocation();
  useEffect(() => {
    const meta = resolveMeta(location);
    document.title = meta.title;
    const set = (kind: "name" | "property", key: string, value: string) => {
      let tag = document.head.querySelector<HTMLMetaElement>(
        `meta[${kind}="${key}"]`,
      );
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(kind, key);
        document.head.appendChild(tag);
      }
      tag.content = value;
    };
    set("name", "description", meta.description);
    set("name", "robots", meta.robots || "index,follow");
    for (const prefix of ["og", "twitter"]) {
      const kind = prefix === "og" ? "property" : "name";
      set(kind, `${prefix}:title`, meta.title);
      set(kind, `${prefix}:description`, meta.description);
      set(kind, `${prefix}:image`, SOCIAL_IMAGE);
    }
    set("property", "og:url", SITE_ORIGIN + meta.path);
    set("property", "og:type", meta.type || "website");
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = SITE_ORIGIN + meta.path;
    document
      .querySelectorAll("script[data-seo-jsonld],script[data-route-jsonld]")
      .forEach((e) => e.remove());
    if (meta.jsonLd?.length) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seoJsonld = "route";
      script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@graph": meta.jsonLd,
      });
      document.head.appendChild(script);
    }
  }, [location]);
  return null;
}
