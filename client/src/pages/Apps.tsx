import { Link } from "wouter";
import {
  ArrowRight,
  ExternalLink,
  Zap,
  Smartphone,
  Layers,
  Rocket,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import CTASection from "@/components/cta-section";
import QuickAnswer from "@/components/QuickAnswer";

interface ManagedApp {
  id: string;
  name: string;
  url: string;
  tagline: string;
  description: string;
  audience: string;
  highlights: string[];
  logo: string;
  accentClass: string;
  availabilityNote?: string;
}

const managedApps: ManagedApp[] = [
  {
    id: "rizza",
    availabilityNote:
      "Public access was unavailable during the October 2026 review. Check the product site for any change.",
    name: "Rizza",
    url: "https://rizza.app",
    tagline: "Your AI wingman in your pocket.",
    description:
      "Built on a simple idea: everyone deserves a wingman. Rizza reads the dating-app conversation, gets the vibe, and hands you replies that actually land — witty, flirty, and always you, just sharper.",
    audience:
      "Anyone staring at a dating-app chat knowing the perfect reply exists but can't quite find it.",
    highlights: [
      "Reads the conversation and matches the vibe before it suggests anything",
      "Witty, flirty replies that still sound like you — not a chatbot",
      "Hands you options fast so you stop overthinking the text back",
      'Designed for the moment of "what do I say next," not enterprise workflows',
    ],
    logo: "/assets/rizza-logo.png",
    accentClass:
      "from-brand-100 to-white dark:from-brand-900 dark:to-brand-950",
  },
  {
    id: "aimech",
    availabilityNote:
      "Public access was unavailable during the October 2026 review. Check the product site for any change.",
    name: "AiMech",
    url: "https://aimech.app",
    tagline: "AI mechanic for everyday car owners.",
    description:
      "An intelligent diagnostics and automation platform that combines AI-driven technical analysis with automated workflow optimization — built so an everyday car owner can describe a sound, a symptom, or a dashboard light and get a real answer.",
    audience:
      "Everyday car owners who want clear next steps instead of dealership runaround.",
    highlights: [
      "AI diagnostics from plain-language descriptions of the problem",
      "Combines technical analysis with workflow automation",
      "Plain-English answers, not parts-catalog jargon",
      "Helpful before, during, and after the shop visit",
    ],
    logo: "/assets/aimech-logo.png",
    accentClass:
      "from-zinc-900 to-zinc-700 dark:from-zinc-800 dark:to-zinc-900",
  },
  {
    id: "babypeek",
    name: "BabyPeek",
    url: "https://baby.mehyar.us",
    tagline: "Peek at your future baby.",
    description:
      "Upload two photos and let AI dream up your future baby. Get a free sneak peek — unlock the full portrait for $5.",
    audience:
      "Expecting couples and curious parents who want a fun, shareable glimpse of what's coming.",
    highlights: [
      "AI-generated future-baby portrait from two parent photos",
      "Free teaser with a $5 unlock for the full portrait",
      "Shareable reveal cards built for virality",
      "Private by design — your photos stay yours",
    ],
    logo: "/assets/babypeek-logo.png",
    accentClass: "from-sky-100 to-white dark:from-sky-900 dark:to-sky-950",
  },
  {
    id: "roastme",
    name: "RoastMe",
    url: "https://roast.mehyar.us",
    tagline: "Upload a photo. Get destroyed. (Lovingly.)",
    description:
      "RoastMe turns your photo into a savage-but-playful AI roast card you can share. See samples, read the reviews, then take the heat.",
    audience:
      "Anyone with thick skin and a group chat that needs new material.",
    highlights: [
      "AI roast cards from a single photo upload",
      "Savage but playful — built to share, not to wound",
      "Sample roasts and reviews before you commit",
      "One-tap share cards for social",
    ],
    logo: "/assets/roastme-logo.png",
    accentClass:
      "from-orange-100 to-white dark:from-orange-900 dark:to-orange-950",
  },
  {
    id: "crayonkid",
    name: "Crayon Kid",
    url: "https://crayonkid.mehyar.us",
    tagline: "A coloring book with YOUR kid's name on every page.",
    description:
      "Type your kid's name and get a personalized coloring book with their name on every page. AI-generated line art, printable at home.",
    audience:
      "Parents and gift-givers who want something personal, not another plastic toy.",
    highlights: [
      "Personalized with your child's name on every page",
      "AI-generated coloring pages, printable at home",
      "Makes a great gift — personal without the price tag",
      "New pages generated on demand",
    ],
    logo: "/assets/crayonkid-logo.png",
    accentClass:
      "from-amber-100 to-white dark:from-amber-900 dark:to-amber-950",
  },
  {
    id: "mehyarjobs",
    name: "mehyar.jobs",
    url: "https://jobs.mehyar.us",
    tagline: "7,000+ careers, fit-scored.",
    description:
      "Daily scan of Fortune 500, Forbes Global 2000, Inc 5000, and S&P 500 career pages — ranked by fit to your profile, not by who paid to promote.",
    audience:
      "Job seekers who are tired of scrolling the same 50 listings on every board.",
    highlights: [
      "7,000+ careers scanned daily from top employer career pages",
      "Fit-scored against your profile, not keyword-matched",
      "Covers Fortune 500, Forbes Global 2000, Inc 5000, and S&P 500",
      "Fresh every morning — no stale reposts",
    ],
    logo: "/assets/jobs-logo.png",
    accentClass:
      "from-emerald-100 to-white dark:from-emerald-900 dark:to-emerald-950",
  },
  {
    id: "stuffprettygood",
    name: "Stuff Pretty Good",
    url: "https://stuffprettygood.com",
    tagline: "Useful gifts, starter kits & budget finds.",
    description:
      "Stuff Pretty Good helps you find useful gifts, starter kits, travel gear, kitchen helpers, and budget finds — curated, honestly reviewed, no markup games.",
    audience:
      "Shoppers who want the good stuff without the affiliate-site fluff.",
    highlights: [
      "Curated gifts, starter kits, and budget finds",
      "Digital guides: home-office setup and gift-proof playbooks",
      "Honest picks — useful first, commission second",
      "New finds added regularly",
    ],
    logo: "/assets/spg-logo.png",
    accentClass:
      "from-violet-100 to-white dark:from-violet-900 dark:to-violet-950",
  },
  {
    id: "designful",
    name: "Designful",
    url: "https://designful.mehyar.us",
    tagline: "Agency-grade design jobs at $49, delivered after processing.",
    description:
      "An AI design studio that ships real design work at fixed prices: homepage teardowns, logo refreshes, ad creative packs, social launch kits, and hero rewrites — each a one-time $49 with a free watermarked preview before you pay.",
    audience:
      "Founders and small businesses that need real design output today, not an agency retainer.",
    highlights: [
      "Five fixed-price products at $49 each — teardown, logo, ad creative, social kit, hero rewrite",
      "Free preview before you pay anything — a watermarked sample of your real output",
      "Delivery timing and refund terms are shown on the product site before purchase",
      "Token-gated download links — no account needed",
    ],
    logo: "/assets/designful-logo.png",
    accentClass: "from-cyan-100 to-white dark:from-cyan-900 dark:to-cyan-950",
  },
  {
    id: "hustlekit",
    name: "HustleKit",
    url: "https://hustlekit.mehyar.us",
    tagline:
      "Your AI side-hustle starter kit — a personalized 15-page playbook for $27.",
    description:
      "Pick one of three tracks — AI freelance writing, AI video editing, or AI social-media management — answer five quick questions, and get a personalized 15-page playbook: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and a 30-day action plan. Free sample page before you pay; one-time $27, no subscription.",
    audience:
      "Beginners who want a concrete, skill-plus-AI plan for landing their first paying clients.",
    highlights: [
      "Three tracks: AI freelance writing, AI video editing, AI social-media management",
      "Personalized 15-page PDF playbook — niche, offer, pricing, outreach scripts, 30-day plan",
      "Free sample playbook page before you pay anything",
      "One-time $27 - review the product site's current refund terms before purchase",
    ],
    logo: "/assets/hustlekit-logo.png",
    accentClass: "from-lime-100 to-white dark:from-lime-900 dark:to-lime-950",
  },
  {
    id: "sprint30",
    name: "Sprint30",
    url: "https://sprint30.mehyar.us",
    tagline: "30 days. 30 missions. One real side-income stream.",
    description:
      "A 30-day challenge that builds a real side-income stream: pick a lane, ship an offer, land your first customers. One specific, skill-framed mission a day by email, plus a personal dashboard with your current day and progress checklist — $37 one-time, with days 1–3 free to preview.",
    audience:
      "Builders and freelancers who want a concrete 30-day plan to launch paid work, not another course.",
    highlights: [
      "30 daily missions — specific steps, real tools, zero hype",
      "Days 1–3 free to preview before you pay anything",
      "Personal dashboard with your current day + progress checklist",
      "Reply-driven emails — every mission pulls a real response",
    ],
    logo: "/assets/sprint30-logo.png",
    accentClass: "from-lime-100 to-white dark:from-lime-900 dark:to-lime-950",
  },
  {
    id: "bizbuilder",
    name: "BizBuilder",
    url: "https://bizbuilder.mehyar.us",
    tagline: "Your business idea becomes a launch-ready plan for $17.",
    description:
      "An AI business builder that turns a 2-sentence idea into a one-page business plan, full landing-page copy, and a 5-email welcome sequence — delivered as a styled web doc plus PDF, with a free real excerpt before you pay.",
    audience:
      "Solo founders and side-hustlers who want a working plan today, not a $2,000 agency engagement.",
    highlights: [
      "Free real plan excerpt from your own idea — concept, customer, section, milestones",
      "One $17 one-time build: 8-section plan, landing copy, 5-email sequence",
      "Delivered after processing as a styled web doc + PDF — no account needed",
      "No income promises, ever — plans on founder actions, not fantasy outcomes",
    ],
    logo: "/assets/bizbuilder-logo.png",
    accentClass:
      "from-slate-100 to-white dark:from-slate-900 dark:to-slate-950",
  },
  {
    id: "creditfixkit",
    name: "CreditFix Kit",
    url: "https://creditfixkit.mehyar.us",
    tagline: "Fix your credit yourself — the letters, the plan, the knowledge.",
    description:
      "A DIY credit repair kit: personalized dispute letter templates, a 12-month rebuild plan, and a plain-English score-factor explainer — delivered as a PDF for a one-time $47. General information only, never legal advice, no guaranteed outcomes.",
    audience:
      "Anyone with collections, late payments, or a thin file who wants to do credit repair themselves instead of paying a monthly service.",
    highlights: [
      "Personalized dispute letters with your details merged in",
      "12-month month-by-month rebuild plan for your situation",
      "Plain-English explainer of what actually moves a score",
      "Free score-factor preview before you pay anything",
    ],
    logo: "/assets/creditfixkit-logo.png",
    accentClass:
      "from-indigo-100 to-white dark:from-indigo-900 dark:to-indigo-950",
  },
  {
    id: "prepguide",
    name: "PrepGuide",
    url: "https://prepguide.mehyar.us",
    tagline: "A preparedness plan built around your actual household.",
    description:
      "Answer six questions about your household — adults, kids, pets, home type, region, budget — and get a personalized preparedness playbook: a 72-hour checklist scaled to your people, exact water-storage math, a 30-day food plan, a power-outage playbook, and a prioritized buy list, delivered as a PDF for a one-time $37. Calm, practical, specific — no fear-mongering.",
    audience:
      "Households who want calm, practical preparedness built around their actual home — not a generic checklist.",
    highlights: [
      "Personalized 72-hour checklist scaled to your household size",
      "Exact water-storage math for your people, home, and region",
      "30-day food plan and power-outage playbook for your budget tier",
      "One-time $37 — free teaser first, PDF download, no account needed",
    ],
    logo: "/assets/prepguide-logo.png",
    accentClass:
      "from-stone-100 to-white dark:from-stone-900 dark:to-stone-950",
  },
  {
    id: "truesketch",
    name: "TrueSketch",
    url: "https://truesketch.mehyar.us",
    tagline: "Your AI portrait sketch + a 2-page reading about you — for $37.",
    description:
      "Tell TrueSketch your name, birthdate, and a few lines about your personality and goals, and get a personalized AI portrait sketch plus a fun, warm 2-page reading about who you are and where you're headed — delivered to a private gallery link. Free sample sketch + reading excerpt before you pay; one-time $37, no subscription. For entertainment purposes only.",
    audience:
      "Anyone curious about themselves — a personal keepsake, a gift, or a little mystical fun.",
    highlights: [
      "Personalized AI portrait sketch painted from your intake (style reference selfie optional)",
      "Fun, warm 2-page personalized reading about your personality and path",
      "Free sample sketch + reading excerpt before you pay anything",
      "One-time $37 with a token-gated private gallery — no account needed",
    ],
    logo: "/assets/truesketch-logo.png",
    accentClass:
      "from-violet-100 to-white dark:from-violet-900 dark:to-violet-950",
  },
  {
    id: "tiktokgrowth",
    availabilityNote:
      "Product link unavailable. Availability and current checkout are being verified.",
    name: "TikTok Growth System",
    url: "https://tiktokgrowth.mehyar.us",
    tagline: "A 30-day organic TikTok playbook, generated for your niche.",
    description:
      "An AI playbook builder for organic short-form growth: tell it your niche, camera comfort, and hours per week, and it generates a 30-day posting plan, 30 first-3-second hook scripts, a bio + CTA pack, and a trend-jacking playbook — one-time $27 with 5 free hook scripts before you pay.",
    audience:
      "Creators, founders, and small businesses starting or restarting organic TikTok growth.",
    highlights: [
      "30-day posting plan built around your niche, schedule, and on-camera comfort",
      "30 hook scripts for the first 3 seconds, each with why-it-works and delivery tips",
      "Bio + CTA pack and a trend-jacking playbook — original-content methods only",
      "5 free hook scripts before you pay — $27 one-time, 7-day redo-or-refund",
    ],
    logo: "/assets/tiktokgrowth-logo.png",
    accentClass: "from-rose-100 to-white dark:from-rose-900 dark:to-rose-950",
  },
  {
    id: "plrvault",
    name: "PLR Vault",
    url: "https://plrvault.mehyar.us",
    tagline:
      "Five sellable digital packs you can rebrand and resell — for $9.95.",
    description:
      "A private-label-rights vault: a 2026 planner pack with Canva-editable templates, a 30-day content calendar, 50 email swipes, and 8 mini-course blueprints — all rebrandable, all yours to resell and keep 100%. Free teaser on the site; the full vault is a one-time $9.95.",
    audience:
      "Creators and side-hustlers who want ready-to-sell digital products without starting from a blank page.",
    highlights: [
      "2026 planner pack with Canva-editable SVG templates",
      "30-day content calendar — hooks, captions, and CTAs done for you",
      "50-email swipe pack plus 8 mini-course blueprints",
      "Plain-English PLR license: rebrand, resell as your own, keep 100%",
    ],
    logo: "/assets/plrvault-logo.png",
    accentClass:
      "from-amber-100 to-white dark:from-amber-900 dark:to-amber-950",
  },
  {
    id: "freelanceros",
    name: "FreelancerOS",
    url: "https://freelanceros.mehyar.us",
    tagline: "Your entire freelance business. One dashboard.",
    description:
      "The freelancer operating system: a client tracker with follow-up reminders, a branded invoice generator with PDF export, a content pipeline board, and a downloadable template pack (contract, proposal, client onboarding) — one-time $29 purchase; see the product site for current terms.",
    audience:
      "Freelancers and solo operators who are done juggling spreadsheets, invoice tools, and sticky notes.",
    highlights: [
      "Client tracker with statuses and follow-up reminders so no lead goes cold",
      "Branded invoice generator with one-click PDF export",
      "Content pipeline board from idea to published",
      "Contract, proposal, and onboarding templates included — free interactive demo before you pay",
    ],
    logo: "/assets/freelanceros-logo.png",
    accentClass:
      "from-slate-100 to-white dark:from-slate-900 dark:to-slate-950",
  },
  {
    id: "promptpack",
    name: "PromptPack Pro",
    url: "https://promptpack.mehyar.us",
    tagline: "50 AI prompts + 10 swipe files, written for your trade.",
    description:
      "Pick your profession \u2014 contractor, realtor, coach, or freelancer \u2014 and get 50 outcome-driven AI prompts plus 10 copy-paste swipe files, generated for exactly what you sell. One-time $19, with a free 5-prompt teaser before you pay.",
    audience:
      "Contractors, realtors, coaches, and freelancers who want AI output that sounds like their trade, not generic filler.",
    highlights: [
      "50 outcome-driven prompts per profession \u2014 quotes, follow-ups, review replies, content",
      "10 copy-paste swipe files for the messages that close deals",
      "Try 5 free prompts first \u2014 no email, no signup",
      "Token-gated private link + PDF download \u2014 no account needed",
    ],
    logo: "/assets/promptpack-logo.png",
    accentClass:
      "from-orange-100 to-white dark:from-orange-900 dark:to-orange-950",
  },
];

const selectedIds = ["designful", "freelanceros", "bizbuilder"];
const proofs: Record<string, string> = {
  designful:
    "A guided brief-to-deliverable flow: intake, generation and digital delivery.",
  freelanceros:
    "Client tracking and invoicing organized around a working dashboard.",
  bizbuilder: "A guided business-planning experience with structured outputs.",
};
const Apps = () => {
  const featured = managedApps.filter((app) => selectedIds.includes(app.id));
  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <p className="site-eyebrow">Products & labs</p>
          <h1 className="site-display mt-4">
            See the engineering in a working product.
          </h1>
          <p className="site-lede mt-5 max-w-3xl">
            Owned products show examples of the interfaces and workflows we
            build. They are separate from client work and do not establish
            business outcomes or adoption.
          </p>
          <Link
            href="/contact"
            className={buttonVariants({ variant: "cta", size: "lg" }) + " mt-7"}
          >
            Discuss your business
          </Link>
        </div>
        <div className="site-shell">
          <Link
            href="/explore?topic=choosing%20business%20software"
            className="mt-5 inline-flex min-h-11 items-center underline"
          >
            Ask The Mayor to compare these ideas →
          </Link>
        </div>
      </section>
      <section className="px-4 pb-16">
        <div className="site-shell mb-10 rounded-2xl border border-border bg-secondary p-7"><p className="site-eyebrow">Our business AI workspace</p><h2 className="text-3xl font-semibold mt-3">The Mayor</h2><p className="mt-3 leading-7 max-w-3xl">Business knowledge, customers, tasks and appointments, with an assistant you can talk to. Start on Free $0, or choose Pro $14 USD/month for more assistant time.</p><Link className="mayor-primary mt-5 w-fit" href="/mayor">Meet The Mayor & see plans <ArrowRight size={17}/></Link></div>
        <div className="site-shell">
          <h2 className="text-2xl font-semibold">Business workflow examples</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {featured.map((app) => (
              <article key={app.id} className="rounded-2xl border p-6">
                {app.id === "designful" || app.id === "bizbuilder" ? (
                  <div aria-hidden="true" className="mb-5 flex h-20 w-20 items-center justify-center rounded-xl bg-brand-50 text-3xl font-semibold text-brand-800">{app.name.slice(0, 1)}</div>
                ) : <img
                  src={app.logo}
                  alt={`${app.name} product logo`}
                  width="80"
                  height="80"
                  loading="lazy"
                  className="mb-5 h-20 w-20 rounded-xl object-contain"
                />}
                <h3 className="text-xl font-semibold">{app.name}</h3>
                <p className="mt-3 leading-7 text-muted-foreground">
                  {proofs[app.id]}
                </p>
                <a
                  className="mt-5 inline-flex min-h-11 items-center text-brand-700 underline dark:text-brand-100"
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Explore product <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Examples from our product catalog. Check current access, features
            and terms on each product site; availability can change.
          </p>
        </div>
      </section>
      <section className="border-t px-4 py-12">
        <div className="site-shell">
          <h2 className="text-2xl font-semibold">
            Full products & labs directory
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Consumer experiments and business tools. Expand a product for its
            description. Catalog entries are not client endorsements.
          </p>
          <div className="mt-6 divide-y">
            {managedApps.map((app) => (
              <details key={app.id} className="py-5">
                <summary className="cursor-pointer text-lg font-semibold">
                  {app.name}{" "}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {app.availabilityNote
                      ? "Public access unavailable"
                      : "Owned product"}
                  </span>
                </summary>
                <div className="mt-4 max-w-3xl">
                  <p className="leading-7 text-muted-foreground">
                    {app.description}
                  </p>
                  {app.availabilityNote && (
                    <p className="mt-3 text-sm">{app.availabilityNote}</p>
                  )}
                  <a
                    href={app.url}
                    className="mt-4 inline-flex min-h-11 items-center underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Product site <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </div>
              </details>
            ))}
          </div>
          <p className="mt-6 text-sm">
            <Link href="/data-deletion" className="underline">
              Data deletion information
            </Link>
          </p>
        </div>
      </section>
      <CTASection />
    </>
  );
};
export default Apps;
