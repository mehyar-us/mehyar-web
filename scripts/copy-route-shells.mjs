import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServer } from "vite";
const oldShellPaths = [
  "audit",
  "services",
  "pricing",
  "proposals",
  "industries/barbershops-salons",
  "industries/clinics-dentists",
  "industries/real-estate",
  "industries/restaurants-cafes",
  "industries/spas-fitness",
  "industries/home-services",
  "industries/professional-services",
  "industries/auto-services",
  "industries/pet-care",
  "industries/retail",
  "portfolio",
  "blog",
  "newsletter",
  "free-checklist",
  "about",
  "apps",
  "330",
  "micro-offer",
  "booking",
  "book",
  "contact",
  "billing/checkout",
  "billing/success",
  "billing/cancel",
  "admin",
  "admin/now",
  "admin/clients",
  "admin/mayor",
  "admin/leads",
  "admin/leads/prospect",
  "admin/sent",
  "admin/money",
  "admin/system",
  "admin/newsletter",
  "admin/government",
  "admin/opportunity-scout",
  "admin/email",
  "admin/email/thread",
  "admin/analytics",
  "admin/prospects",
  "admin/today",
  "unsubscribe",
  "privacy-policy",
  "terms",
  "sitemap",
  "data-deletion",
  "q", // hosted quote shell — slug is dynamic, wouter renders on client
];
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const {
    render,
    resolveMeta,
    publicPaths,
    aliases,
    SITE_ORIGIN,
    SOCIAL_IMAGE,
  } = await server.ssrLoadModule("/src/prerender.tsx");
  const template = readFileSync("dist/public/index.html", "utf8").replace(
    /<script type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g,
    "",
  );
  const escape = (v) =>
    String(v)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  const paths = [
    ...new Set([
      ...publicPaths,
      "/unsubscribe",
      "/audit/report",
      ...Object.keys(aliases),
      ...oldShellPaths.map((p) => "/" + p),
      "/industries",
      "/client-template",
      "/404",
    ]),
  ];
  for (const path of paths) {
    const meta = resolveMeta(path);
    const renderPath = aliases[path] || path;
    const isPrivate =
      /^\/(admin|billing|q|proposals|client-template)(\/|$)/.test(path);
    let html = template.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escape(meta.title)}</title>`,
    );
    const values = {
      description: meta.description,
      robots: meta.robots || "index,follow",
      "og:title": meta.title,
      "og:description": meta.description,
      "og:type": meta.type || "website",
      "og:url": SITE_ORIGIN + meta.path,
      "og:image": SOCIAL_IMAGE,
      "og:image:alt": "MehyarSoft — custom AI built around your business",
      "twitter:title": meta.title,
      "twitter:description": meta.description,
      "twitter:image": SOCIAL_IMAGE,
      "twitter:image:alt": "MehyarSoft — custom AI built around your business",
    };
    for (const [key, value] of Object.entries(values))
      html = html.replace(
        new RegExp(`<meta (name|property)="${key}" content="[^"]*"\\s*/?>`),
        `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${escape(value)}" />`,
      );
    html = html.replace(
      /<link rel="canonical" href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${escape(SITE_ORIGIN + meta.path)}" />`,
    );
    if (!isPrivate)
      html = html.replace(
        '<div id="root"></div>',
        `<div id="root">${render(renderPath)}</div>`,
      );
    if (meta.jsonLd?.length)
      html = html.replace(
        "</head>",
        `<script type="application/ld+json" data-seo-jsonld="route">${JSON.stringify({ "@context": "https://schema.org", "@graph": meta.jsonLd }).replaceAll("<", "\\u003c")}</script></head>`,
      );
    const target =
      path === "/"
        ? "dist/public/index.html"
        : join("dist/public", path.slice(1), "index.html");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, html);
  }
  writeFileSync(
    "dist/public/404.html",
    readFileSync("dist/public/404/index.html", "utf8"),
  );
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map((path) => `<url><loc>${SITE_ORIGIN}${path}</loc></url>`).join("")}</urlset>`;
  writeFileSync("dist/public/sitemap.xml", sitemap);
  console.log(
    `Prerendered ${paths.length} route shells; sitemap has ${publicPaths.length} canonical public URLs.`,
  );
} finally {
  await server.close();
}
