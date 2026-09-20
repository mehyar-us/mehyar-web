import { Link } from "wouter";
import { ArrowRight, ExternalLink, Zap, Smartphone, Layers, Rocket } from "lucide-react";
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
}

const managedApps: ManagedApp[] = [
  {
    id: "rizza",
    name: "Rizza",
    url: "https://rizza.app",
    tagline: "Your AI wingman in your pocket.",
    description:
      "Built on a simple idea: everyone deserves a wingman. Rizza reads the dating-app conversation, gets the vibe, and hands you replies that actually land — witty, flirty, and always you, just sharper.",
    audience: "Anyone staring at a dating-app chat knowing the perfect reply exists but can't quite find it.",
    highlights: [
      "Reads the conversation and matches the vibe before it suggests anything",
      "Witty, flirty replies that still sound like you — not a chatbot",
      "Hands you options fast so you stop overthinking the text back",
      "Designed for the moment of \"what do I say next,\" not enterprise workflows",
    ],
    logo: "/assets/rizza-logo.png",
    accentClass: "from-brand-100 to-white dark:from-brand-900 dark:to-brand-950",
  },
  {
    id: "aimech",
    name: "AiMech",
    url: "https://aimech.app",
    tagline: "AI mechanic for everyday car owners.",
    description:
      "An intelligent diagnostics and automation platform that combines AI-driven technical analysis with automated workflow optimization — built so an everyday car owner can describe a sound, a symptom, or a dashboard light and get a real answer.",
    audience: "Everyday car owners who want clear next steps instead of dealership runaround.",
    highlights: [
      "AI diagnostics from plain-language descriptions of the problem",
      "Combines technical analysis with workflow automation",
      "Plain-English answers, not parts-catalog jargon",
      "Helpful before, during, and after the shop visit",
    ],
    logo: "/assets/aimech-logo.png",
    accentClass: "from-zinc-900 to-zinc-700 dark:from-zinc-800 dark:to-zinc-900",
  },
  {
    id: "babypeek",
    name: "BabyPeek",
    url: "https://baby.mehyar.us",
    tagline: "Peek at your future baby.",
    description:
      "Upload two photos and let AI dream up your future baby. Get a free sneak peek — unlock the full portrait for $5.",
    audience: "Expecting couples and curious parents who want a fun, shareable glimpse of what's coming.",
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
    audience: "Anyone with thick skin and a group chat that needs new material.",
    highlights: [
      "AI roast cards from a single photo upload",
      "Savage but playful — built to share, not to wound",
      "Sample roasts and reviews before you commit",
      "One-tap share cards for social",
    ],
    logo: "/assets/roastme-logo.png",
    accentClass: "from-orange-100 to-white dark:from-orange-900 dark:to-orange-950",
  },
  {
    id: "crayonkid",
    name: "Crayon Kid",
    url: "https://crayonkid.mehyar.us",
    tagline: "A coloring book with YOUR kid's name on every page.",
    description:
      "Type your kid's name and get a personalized coloring book with their name on every page. AI-generated line art, printable at home.",
    audience: "Parents and gift-givers who want something personal, not another plastic toy.",
    highlights: [
      "Personalized with your child's name on every page",
      "AI-generated coloring pages, printable at home",
      "Makes a great gift — personal without the price tag",
      "New pages generated on demand",
    ],
    logo: "/assets/crayonkid-logo.png",
    accentClass: "from-amber-100 to-white dark:from-amber-900 dark:to-amber-950",
  },
  {
    id: "mehyarjobs",
    name: "mehyar.jobs",
    url: "https://jobs.mehyar.us",
    tagline: "7,000+ careers, fit-scored.",
    description:
      "Daily scan of Fortune 500, Forbes Global 2000, Inc 5000, and S&P 500 career pages — ranked by fit to your profile, not by who paid to promote.",
    audience: "Job seekers who are tired of scrolling the same 50 listings on every board.",
    highlights: [
      "7,000+ careers scanned daily from top employer career pages",
      "Fit-scored against your profile, not keyword-matched",
      "Covers Fortune 500, Forbes Global 2000, Inc 5000, and S&P 500",
      "Fresh every morning — no stale reposts",
    ],
    logo: "/assets/jobs-logo.png",
    accentClass: "from-emerald-100 to-white dark:from-emerald-900 dark:to-emerald-950",
  },
  {
    id: "stuffprettygood",
    name: "Stuff Pretty Good",
    url: "https://stuffprettygood.com",
    tagline: "Useful gifts, starter kits & budget finds.",
    description:
      "Stuff Pretty Good helps you find useful gifts, starter kits, travel gear, kitchen helpers, and budget finds — curated, honestly reviewed, no markup games.",
    audience: "Shoppers who want the good stuff without the affiliate-site fluff.",
    highlights: [
      "Curated gifts, starter kits, and budget finds",
      "Digital guides: home-office setup and gift-proof playbooks",
      "Honest picks — useful first, commission second",
      "New finds added regularly",
    ],
    logo: "/assets/spg-logo.png",
    accentClass: "from-violet-100 to-white dark:from-violet-900 dark:to-violet-950",
  },
  {
    id: "designful",
    name: "Designful",
    url: "https://designful.mehyar.us",
    tagline: "Agency-grade design jobs at $49, delivered in minutes.",
    description:
      "An AI design studio that ships real design work at fixed prices: homepage teardowns, logo refreshes, ad creative packs, social launch kits, and hero rewrites — each a one-time $49 with a free watermarked preview before you pay.",
    audience: "Founders and small businesses that need real design output today, not an agency retainer.",
    highlights: [
      "Five fixed-price products at $49 each — teardown, logo, ad creative, social kit, hero rewrite",
      "Free preview before you pay anything — a watermarked sample of your real output",
      "Delivered in about 15 minutes with a 7-day redo-or-refund guarantee",
      "Token-gated download links — no account needed",
    ],
    logo: "/assets/designful-logo.png",
    accentClass: "from-cyan-100 to-white dark:from-cyan-900 dark:to-cyan-950",
  },
  {
    id: "hustlekit",
    name: "HustleKit",
    url: "https://hustlekit.mehyar.us",
    tagline: "Your AI side-hustle starter kit — a personalized 15-page playbook for $27.",
    description:
      "Pick one of three tracks — AI freelance writing, AI video editing, or AI social-media management — answer five quick questions, and get a personalized 15-page playbook: your niche, your offer and pricing, where to find your first clients, word-for-word outreach scripts, and a 30-day action plan. Free sample page before you pay; one-time $27, no subscription.",
    audience: "Beginners who want a concrete, skill-plus-AI plan for landing their first paying clients.",
    highlights: [
      "Three tracks: AI freelance writing, AI video editing, AI social-media management",
      "Personalized 15-page PDF playbook — niche, offer, pricing, outreach scripts, 30-day plan",
      "Free sample playbook page before you pay anything",
      "One-time $27 with a 7-day redo-or-refund guarantee — no account needed",
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
    audience: "Builders and freelancers who want a concrete 30-day plan to launch paid work, not another course.",
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
    audience: "Solo founders and side-hustlers who want a working plan today, not a $2,000 agency engagement.",
    highlights: [
      "Free real plan excerpt from your own idea — concept, customer, section, milestones",
      "One $17 one-time build: 8-section plan, landing copy, 5-email sequence",
      "Delivered in minutes as a styled web doc + PDF — no account needed",
      "No income promises, ever — plans on founder actions, not fantasy outcomes",
    ],
    logo: "/assets/bizbuilder-logo.png",
    accentClass: "from-slate-100 to-white dark:from-slate-900 dark:to-slate-950",
  },
  {
    id: "creditfixkit",
    name: "CreditFix Kit",
    url: "https://creditfixkit.mehyar.us",
    tagline: "Fix your credit yourself — the letters, the plan, the knowledge.",
    description:
      "A DIY credit repair kit: personalized dispute letter templates, a 12-month rebuild plan, and a plain-English score-factor explainer — delivered as a PDF for a one-time $47. General information only, never legal advice, no guaranteed outcomes.",
    audience: "Anyone with collections, late payments, or a thin file who wants to do credit repair themselves instead of paying a monthly service.",
    highlights: [
      "Personalized dispute letters with your details merged in",
      "12-month month-by-month rebuild plan for your situation",
      "Plain-English explainer of what actually moves a score",
      "Free score-factor preview before you pay anything",
    ],
    logo: "/assets/creditfixkit-logo.png",
    accentClass: "from-indigo-100 to-white dark:from-indigo-900 dark:to-indigo-950",
  },
  {
    id: "prepguide",
    name: "PrepGuide",
    url: "https://prepguide.mehyar.us",
    tagline: "A preparedness plan built around your actual household.",
    description:
      "Answer six questions about your household — adults, kids, pets, home type, region, budget — and get a personalized preparedness playbook: a 72-hour checklist scaled to your people, exact water-storage math, a 30-day food plan, a power-outage playbook, and a prioritized buy list, delivered as a PDF for a one-time $37. Calm, practical, specific — no fear-mongering.",
    audience: "Households who want calm, practical preparedness built around their actual home — not a generic checklist.",
    highlights: [
      "Personalized 72-hour checklist scaled to your household size",
      "Exact water-storage math for your people, home, and region",
      "30-day food plan and power-outage playbook for your budget tier",
      "One-time $37 — free teaser first, PDF download, no account needed",
    ],
    logo: "/assets/prepguide-logo.png",
    accentClass: "from-stone-100 to-white dark:from-stone-900 dark:to-stone-950",
  },
  {
    id: "truesketch",
    name: "TrueSketch",
    url: "https://truesketch.mehyar.us",
    tagline: "Your AI portrait sketch + a 2-page reading about you — for $37.",
    description:
      "Tell TrueSketch your name, birthdate, and a few lines about your personality and goals, and get a personalized AI portrait sketch plus a fun, warm 2-page reading about who you are and where you're headed — delivered to a private gallery link. Free sample sketch + reading excerpt before you pay; one-time $37, no subscription. For entertainment purposes only.",
    audience: "Anyone curious about themselves — a personal keepsake, a gift, or a little mystical fun.",
    highlights: [
      "Personalized AI portrait sketch painted from your intake (style reference selfie optional)",
      "Fun, warm 2-page personalized reading about your personality and path",
      "Free sample sketch + reading excerpt before you pay anything",
      "One-time $37 with a token-gated private gallery — no account needed",
    ],
    logo: "/assets/truesketch-logo.png",
    accentClass: "from-violet-100 to-white dark:from-violet-900 dark:to-violet-950",
  },
  {
    id: "tiktokgrowth",
    name: "TikTok Growth System",
    url: "https://tiktokgrowth.mehyar.us",
    tagline: "A 30-day organic TikTok playbook, generated for your niche.",
    description:
      "An AI playbook builder for organic short-form growth: tell it your niche, camera comfort, and hours per week, and it generates a 30-day posting plan, 30 first-3-second hook scripts, a bio + CTA pack, and a trend-jacking playbook — one-time $27 with 5 free hook scripts before you pay.",
    audience: "Creators, founders, and small businesses starting or restarting organic TikTok growth.",
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
    tagline: "Five sellable digital packs you can rebrand and resell — for $9.95.",
    description:
      "A private-label-rights vault: a 2026 planner pack with Canva-editable templates, a 30-day content calendar, 50 email swipes, and 8 mini-course blueprints — all rebrandable, all yours to resell and keep 100%. Free teaser on the site; the full vault is a one-time $9.95.",
    audience: "Creators and side-hustlers who want ready-to-sell digital products without starting from a blank page.",
    highlights: [
      "2026 planner pack with Canva-editable SVG templates",
      "30-day content calendar — hooks, captions, and CTAs done for you",
      "50-email swipe pack plus 8 mini-course blueprints",
      "Plain-English PLR license: rebrand, resell as your own, keep 100%",
    ],
    logo: "/assets/plrvault-logo.png",
    accentClass: "from-amber-100 to-white dark:from-amber-900 dark:to-amber-950",
  },
  {
    id: "freelanceros",
    name: "FreelancerOS",
    url: "https://freelanceros.mehyar.us",
    tagline: "Your entire freelance business. One dashboard.",
    description:
      "The freelancer operating system: a client tracker with follow-up reminders, a branded invoice generator with PDF export, a content pipeline board, and a downloadable template pack (contract, proposal, client onboarding) — one $29 payment, yours forever.",
    audience: "Freelancers and solo operators who are done juggling spreadsheets, invoice tools, and sticky notes.",
    highlights: [
      "Client tracker with statuses and follow-up reminders so no lead goes cold",
      "Branded invoice generator with one-click PDF export",
      "Content pipeline board from idea to published",
      "Contract, proposal, and onboarding templates included — free interactive demo before you pay",
    ],
    logo: "/assets/freelanceros-logo.png",
    accentClass: "from-slate-100 to-white dark:from-slate-900 dark:to-slate-950",
  },
  {
    id: "promptpack",
    name: "PromptPack Pro",
    url: "https://promptpack.mehyar.us",
    tagline: "50 AI prompts + 10 swipe files, written for your trade.",
    description:
      "Pick your profession \u2014 contractor, realtor, coach, or freelancer \u2014 and get 50 outcome-driven AI prompts plus 10 copy-paste swipe files, generated for exactly what you sell. One-time $19, with a free 5-prompt teaser before you pay.",
    audience: "Contractors, realtors, coaches, and freelancers who want AI output that sounds like their trade, not generic filler.",
    highlights: [
      "50 outcome-driven prompts per profession \u2014 quotes, follow-ups, review replies, content",
      "10 copy-paste swipe files for the messages that close deals",
      "Try 5 free prompts first \u2014 no email, no signup",
      "Token-gated private link + PDF download \u2014 no account needed",
    ],
    logo: "/assets/promptpack-logo.png",
    accentClass: "from-orange-100 to-white dark:from-orange-900 dark:to-orange-950",
  },
  {
    id: "openseason",
    name: "OpenSeason",
    url: "https://openseason.mehyar.us",
    tagline: "Every hunting-season date for your state, in plain English.",
    description:
      "Pick your state and get the next three verified season openers free — every date traced to the official state wildlife agency and stamped with its verification. The $12 state pack unlocks every season, deadline, bag limit, and license/tag date plus printable pack and reminders all season.",
    audience: "Weekend deer hunters asking “is muzzleloader open this weekend?” or “did I miss the deadline?”",
    highlights: [
      "Next 3 verified season openers free — no signup, no payment",
      "Every date carries its official state-agency source and verification stamp",
      "$12 state pack: all seasons, deadlines, bag limits, license/tag dates",
      "Printable pack + email reminders all season; one-click unsubscribe everywhere",
    ],
    logo: "/assets/openseason-logo.png",
    accentClass: "from-lime-100 to-white dark:from-lime-900 dark:to-lime-950",
  },
  {
    id: "beachcall",
    name: "BeachCall",
    url: "https://beachcall.mehyar.us",
    tagline: "Should we go to the beach today — and exactly which hours?",
    description:
      "Daily go/no-go beach verdicts with best-hours windows. Free for one beach a day; the $9 summer pass covers all your beaches with morning go/no-go emails all season.",
    audience: "Families and beachgoers on the US East Coast.",
    highlights: [
      "Daily go/no-go verdicts per beach from marine and weather data",
      "Best-hours windows so you arrive when the water and weather are best",
      "Free for one beach a day; the $9 summer pass covers all your beaches",
      "Morning go/no-go emails before the kids wake up, plus a Friday weekend outlook",
    ],
    logo: "/assets/beachcall-logo.png",
    accentClass: "from-teal-100 to-white dark:from-teal-900 dark:to-teal-950",
  },
  {
    id: "carerank",
    name: "CareRank",
    url: "https://carerank.mehyar.us",
    tagline: "Nursing-home shortlist that works for your family, not the facilities.",
    description:
      "A 4-minute quiz about your parent's needs, scored deterministically against real CMS nursing-home data. Free: your match count and blurred top 3. $29 one-time unlocks the full ranked shortlist — per-facility strengths, red flags, decoded CMS ratings, tour questions, and a printable 12-page PDF to share with siblings.",
    audience: "Adult children who need to pick a nursing home this week under discharge-planner pressure.",
    highlights: [
      "Free 4-minute quiz — see how many homes fit, top 3 names blurred",
      "Deterministic scoring over real CMS data — no invented ratings, ever",
      "$29 one-time: full ranked shortlist + printable 12-page PDF",
      "Per-facility strengths, red flags, and what to ask on the tour",
    ],
    logo: "/assets/carerank-logo.png",
    accentClass: "from-teal-100 to-white dark:from-teal-900 dark:to-teal-950",  },];

const buildPillars = [
  {
    icon: Zap,
    title: "Idea → live link in days, not quarters",
    body: "Marketing site, auth, data model, and dashboard assembled from a working playbook — so the cost of testing a new product is a weekend, not a raise.",
  },
  {
    icon: Smartphone,
    title: "PWAs that install like native",
    body: "Add-to-home-screen, offline shell, push notifications, and a real mobile feel without App Store review cycles. Ship to the same URL across every device.",
  },
  {
    icon: Layers,
    title: "One stack, real data, real users",
    body: "Cloudflare Workers for the edge, D1 for storage, Pages for the front-end. The same stack powers mehyar.us and every product we ship — boring on purpose, fast in practice.",
  },
  {
    icon: Rocket,
    title: "Marketing-grade from day one",
    body: "SEO shell, structured data, OG cards, RSS, sitemap, and analytics wired before launch — so the product shows up where real people search, not just in a founder's Discord.",
  },
];

const Apps = () => {
  return (
    <>
      <section className="site-hero">
        <div className="site-shell">
          <p className="site-eyebrow mb-3">
            Live products
          </p>
          <h1 className="site-display max-w-4xl">
            Products we build, ship, and operate.
          </h1>
          <p className="site-lede mt-5 max-w-3xl">
            MehyarSoft doesn't only consult. We ship real products that real users open every day — and we use the same
            playbook to launch yours. Browse the live portfolio below, then read on for what makes the MehyarSoft
            product-launch process fast, boring, and marketing-grade from day one.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/contact" className={buttonVariants({ variant: "cta" })}>
              Brief us on your product idea <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/services" className={buttonVariants({ variant: "outline" })}>
              See consulting offers
            </Link>
          </div>
        </div>
      </section>

      <QuickAnswer
        question="What products does MehyarSoft operate?"
        answer="MehyarSoft builds, ships, and operates its own products — including Rizza (an AI wingman for dating-app replies) and AiMech (AI diagnostics for everyday car owners). The same playbook is offered to clients as a custom-product build engagement."
        ctaHref="/contact"
        ctaLabel="Talk about your product"
      />

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
                Products we own
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-4xl">
                Products we run today.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Each product is a working site with real users, real data, and real follow-up. Click through to see what we
              shipped — each is a good example of how small a marketing-grade launch can be when the stack is
              standardized.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {managedApps.map((app) => (
              <Card
                key={app.id}
                className="group h-full overflow-hidden border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35"
              >
                <div className={`bg-gradient-to-br ${app.accentClass} px-6 py-8`}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/95 p-2 shadow-[0_8px_22px_rgba(8,63,84,0.18)] ring-1 ring-black/5 dark:bg-white/95">
                      <img
                        src={app.logo}
                        alt={`${app.name} logo`}
                        className="h-full w-full object-contain"
                        width="64"
                        height="64"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand-700/80 dark:text-brand-100/80">
                        Live product
                      </p>
                      <h3 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink dark:text-white">
                        {app.name}
                      </h3>
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800 dark:text-brand-100 dark:hover:text-white"
                      >
                        {app.url.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6">
                  <p className="text-base font-medium text-foreground md:text-lg">{app.tagline}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">{app.description}</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
                    Built for
                  </p>
                  <p className="mt-1 text-sm leading-6 text-foreground">{app.audience}</p>
                  <ul className="mt-5 space-y-2.5">
                    {app.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-sm leading-6 text-foreground">
                        <span
                          aria-hidden="true"
                          className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100"
                        />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "default", size: "sm" })}
                    >
                      Visit {app.name} <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                    <Link
                      href={`/blog/${app.id === "rizza" ? "rizza-app-launch-tracking-and-organizing-work-without-the-overhead" : "aimech-app-launch-ai-mechanic-for-everyday-car-owners"}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Read the launch note
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/40 px-4 py-16 dark:bg-white/[0.02] md:py-20">
        <div className="mx-auto max-w-7xl">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            How we ship fast
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-4xl md:leading-[1.05]">
            Products and PWAs in a marketing manner — quickly, without theater.
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            The same process that produced Rizza and AiMech is what MehyarSoft offers clients as a custom-product
            engagement. No agency drama. No "design phase" before the data model exists. Just a working stack, a tight
            feedback loop, and a launch that shows up in search from day one.
          </p>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {buildPillars.map((p) => {
              const Icon = p.icon;
              return (
                <Card key={p.title} className="h-full border-border bg-card">
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                      <Icon aria-hidden="true" size={22} />
                    </div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground">{p.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">{p.body}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-10 rounded-[1.5rem] border border-border bg-card p-6 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
              The MehyarSoft product playbook
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground md:text-2xl">
              From napkin sketch to public launch URL in under three weeks.
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              We don't pitch "a discovery phase followed by a build phase." We ship a thin slice on a real domain, see
              if anyone opens it, and iterate. That means your product gets real users, real analytics, and real SEO
              credit while it's still small — not six months later when the marketing window has closed.
            </p>
            <ul className="mt-5 grid grid-cols-1 gap-3 text-sm leading-6 text-foreground md:grid-cols-2">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Marketing site with SEO shell and structured data on launch day</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Auth, data, and one core flow working end-to-end before any polish</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>Hosted on the same Cloudflare stack that runs mehyar.us</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-700 dark:bg-brand-100" />
                <span>PWA install prompt and share card built into the first release</span>
              </li>
            </ul>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/contact" className={buttonVariants({ variant: "cta" })}>
                Brief us on your product <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/services" className={buttonVariants({ variant: "outline" })}>
                See how engagements work
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CTASection />

      <section className="bg-background px-4 pb-16 md:pb-20">
        <div className="mx-auto max-w-5xl rounded-2xl border border-border bg-card/50 p-6 text-sm leading-6 text-muted-foreground md:p-8">
          <p className="font-semibold text-foreground">Your data, your call</p>
          <p className="mt-2">
            Every MehyarSoft-built product exposes an in-product account deletion path plus an email
            fallback. We action deletion requests within 14 days and confirm in writing.
            {" "}
            <Link href="/data-deletion" className="text-brand-700 underline dark:text-brand-100">
              See the data-deletion policy
            </Link>{" "}
            for the full process, product-by-product details (Rizza, AiMech, Designful, Sprint30, BizBuilder, CreditFix Kit, HustleKit, TikTok Growth System, PLR Vault, PromptPack Pro, OpenSeason, BeachCall, CareRank), and the request form.
          </p>
        </div>
      </section>
    </>
  );
};

export default Apps;

