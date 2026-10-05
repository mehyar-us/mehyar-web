import { blogPosts } from "@/data/blog-posts";
import { projects } from "@/data/portfolio-projects";
import { industryOffers } from "@/data/industry-offers";
export const SITE_ORIGIN = "https://mehyar.us";
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/assets/mehyarsoft-social-1200x630.png`;
export type SeoMeta = {
  title: string;
  description: string;
  path: string;
  robots?: string;
  type?: "website" | "article";
  jsonLd?: Record<string, unknown>[];
};
const pages: Record<string, [string, string]> = {
  "/mayor": ["The Mayor: AI for Your Local Business", "Meet The Mayor: business knowledge, customers, tasks, appointments and voice assistance. Free $0 and Pro $14 USD/month. Sign in to your private business workspace."],
  "/explore": ["Ask The Mayor: Visual AI Conversation", "Talk to The Mayor about business, AI and software. Explore visual answers and save conversations on your device by choice. No signup to begin."],
  "/enterprise": ["Custom AI for Enterprise & Regulated Teams", "Explore scoped AI and software pilots for technology, healthcare, pharma, finance and enterprise operations, with approved knowledge, access boundaries and human review."],
  "/": [
    "Custom AI Built Around Your Business",
    "Custom AI systems tailored to your business workflows, approved knowledge and existing tools. Founder-led engineering and support.",
  ],
  "/services": [
    "Solutions: Custom Business AI",
    "AI for customer response, scheduling and internal operations, shaped around your knowledge, rules and tools.",
  ],
  "/industries": [
    "Custom AI by Industry",
    "Explore ten business contexts and practical examples of tailored AI workflows.",
  ],
  "/pricing": [
    "Scope, Pricing & Ongoing Costs",
    "Understand discovery, custom implementation, usage costs and ongoing support. Custom AI builds are quoted to scope.",
  ],
  "/portfolio": [
    "Work & Illustrative Workflow Patterns",
    "Explore illustrative engagement patterns and expected deliverables. These are not client case studies or measured results.",
  ],
  "/apps": [
    "Products & Labs",
    "Explore owned MehyarSoft products and the engineering workflows behind them, separate from client work.",
  ],
  "/about": [
    "About MehyarSoft & Mehyar Swelim",
    "Founder-led engineering: meet Mehyar Swelim and learn how custom AI work is planned, built and supported.",
  ],
  "/contact": [
    "Discuss Your Business",
    "Describe your workflow and current tools. Discuss a custom AI system with MehyarSoft.",
  ],
  "/booking": [
    "Arrange a Business Conversation",
    "Choose an available call time or request scheduling by inquiry or email.",
  ],
  "/micro-offer": [
    "$330 Founder-Led Audit",
    "A focused review of your website, inquiry path and current tools with a written action plan. Implementation is separate.",
  ],
  "/audit": [
    "Free Automated Website Diagnostic",
    "An automated website diagnostic with suggested improvements. Scenario estimates are not measured business outcomes.",
  ],
  "/audit/report": [
    "$5 Automated Website Report",
    "A fuller automated website evaluation. Suggested workflows and estimates are illustrative, not implementation guarantees.",
  ],
  "/blog": [
    "Insights & Practical AI Notes",
    "Practical articles about business workflows, custom software, follow-up and thoughtful automation.",
  ],
  "/free-checklist": [
    "Free Business AI Checklist",
    "Request a practical checklist by email. Ongoing marketing updates are optional.",
  ],
  "/privacy-policy": [
    "Privacy Policy",
    "How MehyarSoft handles information and privacy requests.",
  ],
  "/terms": [
    "Terms",
    "Website terms and engagement boundaries for MehyarSoft.",
  ],
  "/data-deletion": [
    "Data Deletion",
    "Request deletion of data from MehyarSoft products.",
  ],
  "/sitemap": [
    "Sitemap",
    "Browse the public MehyarSoft pages, industry workflows and resources.",
  ],
  "/unsubscribe": [
    "Unsubscribe & Email Preferences",
    "Unsubscribe or update your MehyarSoft email preferences.",
  ],
};
export const aliases: Record<string, string> = {
  "/newsletter": "/free-checklist",
  "/330": "/micro-offer",
  "/book": "/booking",
};
export const publicPaths = [
  ...Object.keys(pages).filter(
    (p) => p !== "/unsubscribe" && p !== "/audit/report",
  ),
  ...industryOffers.map((i) => `/industries/${i.id}`),
  ...projects.map((p) => `/portfolio/${p.id}`),
  ...blogPosts.map((p) => `/blog/${p.slug}`),
];
export function resolveMeta(raw: string): SeoMeta {
  const normalized = raw.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const path = aliases[normalized] || normalized;
  let entry = pages[path];
  let type: "website" | "article" = "website";
  let extra: Record<string, unknown>[] = [];
  if (path.startsWith("/industries/")) {
    const item = industryOffers.find((i) => path === `/industries/${i.id}`);
    if (item)
      entry = [
        `Custom AI for ${item.shortName}`,
        `${item.description} Explore three tailored workflows, integration considerations and custom project scope.`,
      ];
  }
  if (path.startsWith("/portfolio/")) {
    const item = projects.find((i) => path === `/portfolio/${i.id}`);
    if (item)
      entry = [
        `${item.title}: Illustrative Pattern`,
        `${item.description} An illustrative scope, not a measured client result.`,
      ];
  }
  if (path.startsWith("/blog/")) {
    const item = blogPosts.find((i) => path === `/blog/${i.slug}`);
    if (item) {
      entry = [item.title, item.excerpt];
      type = "article";
      extra = [
        {
          "@type": "BlogPosting",
          headline: item.title,
          description: item.excerpt,
          datePublished: item.date,
          author: { "@type": "Person", name: item.author },
          mainEntityOfPage: `${SITE_ORIGIN}${path}`,
        },
      ];
    }
  }
  const privateRoute =
    /^\/(admin|billing|q|proposals|client-template)(\/|$)/.test(path);
  if (privateRoute)
    return {
      title: "Client & Account Area | MehyarSoft",
      description: "MehyarSoft client and account utility.",
      path,
      robots: "noindex,nofollow,noarchive",
    };
  if (!entry)
    return {
      title: "Page Not Found | MehyarSoft",
      description:
        "This page could not be found. Browse MehyarSoft solutions or return home.",
      path,
      robots: "noindex,follow",
    };
  const title = `${entry[0]} | MehyarSoft`;
  return {
    title,
    description: entry[1],
    path,
    type,
    robots:
      path === "/unsubscribe" || path === "/audit/report"
        ? "noindex,follow"
        : "index,follow",
    jsonLd: [
      {
        "@type": "WebPage",
        name: title,
        description: entry[1],
        url: `${SITE_ORIGIN}${path}`,
      },
      ...(path === "/"
        ? [
            {
              "@type": "Organization",
              name: "MehyarSoft LLC",
              url: `${SITE_ORIGIN}/`,
              email: "info@mehyar.us",
              logo: `${SITE_ORIGIN}/assets/mehyarsoft-mark-new-512.png`,
              founder: { "@type": "Person", name: "Mehyar Swelim" },
            },
          ]
        : []),
      ...extra,
    ],
  };
}
