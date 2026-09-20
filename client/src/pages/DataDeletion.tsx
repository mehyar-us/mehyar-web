// DataDeletion.tsx — MehyarSoft LLC public data deletion request page
//
// Purpose: Satisfies Apple App Store / Google Play store requirements for any
// app that accesses user data to provide "a way for users to request that
// their data be deleted". Apple reviewers check for a working URL when
// reviewing Rizza (iOS PWA) and AiMech (Android/iOS PWAs), and Google Play's
// Data safety form requires a public-facing deletion link.
//
// This page is part of the Mehyar.us "Products that access user data" compliance
// set (see /privacy-policy, /terms). It applies to:
//   1. Rizza — https://rizza.app (conversational AI for dating-app replies)
//   2. AiMech — https://aimech.app (AI car diagnostics for everyday drivers)
//   3. Crayon Kid — https://crayonkid.mehyar.us (personalized AI coloring books)
//   4. RoastMe — https://roast.mehyar.us (AI photo roasts)
//   5. BabyPeek — https://baby.mehyar.us (AI future-baby portraits)
//   6. StuffPrettyGood — https://stuffprettygood.com (shopping guides + digital playbooks)
//   7. Mehyar Jobs — https://jobs.mehyar.us (automated personal jobs dashboard)
//   8. Designful — https://designful.mehyar.us (AI design studio: fixed-price design products)
//  9. FreelancerOS — https://freelanceros.mehyar.us (freelancer OS: clients, invoices, content, templates)
//  10. Sprint30 — https://sprint30.mehyar.us (30-day side-income challenge)
//  11. BizBuilder — https://bizbuilder.mehyar.us (AI business builder: idea to launch-ready plan)
//  12. CreditFix Kit — https://creditfixkit.mehyar.us (DIY credit repair kit: dispute letters + rebuild plan)
//  13. HustleKit — https://hustlekit.mehyar.us (AI side-hustle starter kits: personalized playbook PDFs)
//  14. TikTok Growth System — https://tiktokgrowth.mehyar.us (AI-generated organic short-form growth playbook)
//  15. PLR Vault — https://plrvault.mehyar.us (private-label-rights digital product vault)
//  16. TrueSketch — https://truesketch.mehyar.us (personalized AI portrait sketch + 2-page reading)
//  17. PromptPack Pro — https://promptpack.mehyar.us (niche AI prompt packs + swipe files)
//  18. PrepGuide — https://prepguide.mehyar.us (personalized household preparedness playbook)
// Plus any future products MehyarSoft ships.
//
// Two paths are offered:
//   - In-product: every product exposes an in-product "Delete my account & data"
//     action that purges the account and all associated rows in one tap.
//   - Email fallback: anyone can write to info@mehyar.us and we'll action
//     within 14 days. The 14-day window matches the Privacy Policy.
//
// Last updated: 2026-09-14.

import { Trash2, Mail, ShieldCheck, Clock, ExternalLink, Smartphone, MessageSquare, Car, Pencil, Flame, Baby, ShoppingBag, Briefcase, Palette, Zap, Rocket, FileText, Target, TrendingUp, Archive , Sparkles, LayoutDashboard} from "lucide-react";
const company = "MehyarSoft LLC";
const contactEmail = "info@mehyar.us";

interface AppInfo {
  id: string;
  name: string;
  url: string;
  tagline: string;
  icon: any;
  whatWeCollect: string;
  whatWeDelete: string;
  inAppPath: string;
}

const apps: AppInfo[] = [
  {
    id: "rizza",
    name: "Rizza",
    url: "https://rizza.app",
    tagline: "Your AI wingman for dating-app replies.",
    icon: MessageSquare,
    inAppPath: "Settings → Account → Delete my account",
    whatWeCollect:
      "Email address (if you sign in), account handle, optional profile fields you fill in, and the conversation snippets you submit to Rizza so it can suggest a reply. We do not read your messages outside the moments you paste them in.",
    whatWeDelete:
      "Account record, profile fields, every conversation snippet and suggestion stored against your account, push-notification tokens, and any aggregated analytics rows that can be tied back to your account id.",
  },
  {
    id: "aimech",
    name: "AiMech",
    url: "https://aimech.app",
    tagline: "AI mechanic for everyday car owners.",
    icon: Car,
    inAppPath: "Settings → Account → Delete my account",
    whatWeCollect:
      "Email address (if you sign in), the vehicle make / model / year you set up, the symptom descriptions and diagnostic answers you submit, and your saved history of past diagnoses.",
    whatWeDelete:
      "Account record, vehicle profile, full diagnostic history, symptom logs, and any rows tied to your account id in our logs. The diagnostic model itself does not retain your individual inputs after the session — only the rows we explicitly stored.",
  },
  {
    id: "crayonkid",
    name: "Crayon Kid",
    url: "https://crayonkid.mehyar.us",
    tagline: "Personalized AI coloring books for kids.",
    icon: Pencil,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Parent's email address (to save your setup and deliver the purchase), the child's first name (to personalize the pages), chosen theme, generated page images, and checkout records.",
    whatWeDelete:
      "Email address, child's first name and theme choice, generated pages, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "roastme",
    name: "RoastMe",
    url: "https://roast.mehyar.us",
    tagline: "AI photo roasts as shareable image cards.",
    icon: Flame,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Photos you upload for roasting, email address (if you provide one for the teaser or unlock), generated roast text and share cards, and checkout records.",
    whatWeDelete:
      "Uploaded photos, generated roasts and share cards, email address, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "babypeek",
    name: "BabyPeek",
    url: "https://baby.mehyar.us",
    tagline: "AI future-baby portraits.",
    icon: Baby,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "The two parent photos you upload, email address (if you provide one for capture or unlock), generated portrait images, and checkout records.",
    whatWeDelete:
      "Uploaded photos, generated portraits, email address, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "stuffprettygood",
    name: "StuffPrettyGood",
    url: "https://stuffprettygood.com",
    tagline: "AI-assisted shopping guides and digital playbooks.",
    icon: ShoppingBag,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (if you provide one at checkout), digital-product purchase records, and the download links issued to you.",
    whatWeDelete:
      "Email address, purchase records, and download tokens tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "mehyarjobs",
    name: "Mehyar Jobs",
    url: "https://jobs.mehyar.us",
    tagline: "Automated personal jobs dashboard.",
    icon: Briefcase,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (if you provide one for match alerts), your resume / profile data used for scoring, and your match history.",
    whatWeDelete:
      "Email address, resume / profile data, and match history tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "designful",
    name: "Designful",
    url: "https://designful.mehyar.us",
    tagline: "AI design studio: fixed-price design products.",
    icon: Palette,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send download links), the business name / website URL / logo you submit for each design job, the generated design deliverables, and checkout records.",
    whatWeDelete:
      "Email address, submitted business assets, generated deliverables, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
id: "hustlekit",
    name: "HustleKit",
    url: "https://hustlekit.mehyar.us",
    tagline: "AI side-hustle starter kit: personalized playbook PDFs.",
    icon: Target,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send the download link), the track and five intake answers you submit (skills, hours per week, income goal, experience level, niche interest), the generated playbook PDF, and checkout records.",
    whatWeDelete:
      "Email address, intake answers, generated playbook, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "sprint30",
    name: "Sprint30",
    url: "https://sprint30.mehyar.us",
    tagline: "30-day side-income challenge.",
    icon: Zap,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase, send the 30 daily challenge emails, and gate your dashboard), your challenge progress checklist, and checkout records.",
    whatWeDelete:
      "Email address, challenge progress, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "bizbuilder",
    name: "BizBuilder",
    url: "https://bizbuilder.mehyar.us",
    tagline: "AI business builder: idea to launch-ready plan.",
    icon: Rocket,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send deliverable links), the business idea / audience / price point you submit, the generated plan and copy deliverables, and checkout records.",
    whatWeDelete:
      "Email address, submitted intake, generated deliverables, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "creditfixkit",
    name: "CreditFix Kit",
    url: "https://creditfixkit.mehyar.us",
    tagline: "DIY credit repair kit: dispute letters + rebuild plan.",
    icon: FileText,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase), the name / situation / state / goal / account descriptions you submit for personalization, the generated kit PDF, and checkout records.",
    whatWeDelete:
      "Email address, submitted intake details, generated kit, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "tiktokgrowth",
    name: "TikTok Growth System",
    url: "https://tiktokgrowth.mehyar.us",
    tagline: "AI-generated organic short-form growth playbook.",
    icon: TrendingUp,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send the playbook link), your niche, on-camera comfort level, hours per week, optional handle, the generated playbook, and checkout records.",
    whatWeDelete:
      "Email address, submitted inputs, generated playbook, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "plrvault",
    name: "PLR Vault",
    url: "https://plrvault.mehyar.us",
    tagline: "Private-label-rights digital product vault (planner pack, content calendar, email swipes, course outlines).",
    icon: Archive,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send the download link), checkout records, and optional teaser email if you join the list.",
    whatWeDelete:
      "Email address, teaser subscription, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "truesketch",
    name: "TrueSketch",
    url: "https://truesketch.mehyar.us",
    tagline: "Personalized AI portrait sketch + 2-page reading.",
    icon: Sparkles,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase), the name / birthdate / personality-and-goals answers you submit, an optional selfie used only as a style reference for the sketch, the generated sketch and reading, and checkout records.",
    whatWeDelete:
      "Email address, intake answers, optional selfie, generated sketch and reading, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "freelanceros",
    name: "FreelancerOS",
    url: "https://freelanceros.mehyar.us",
    tagline: "Freelancer OS: clients, invoices, content, templates.",
    icon: LayoutDashboard,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and dashboard link), your dashboard data (clients, invoices, content items, settings), and checkout records.",
    whatWeDelete:
      "Email address, dashboard data, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
  {
    id: "promptpack",
    name: "PromptPack Pro",
    url: "https://promptpack.mehyar.us",
    tagline: "Niche AI prompt packs + swipe files.",
    icon: FileText,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase and send your pack link), the profession you pick at checkout, the generated prompt pack, and checkout records.",
    whatWeDelete:
      "Email address, profession choice, generated prompt pack, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },  {
    id: "prepguide",
    name: "PrepGuide",
    url: "https://prepguide.mehyar.us",
    tagline: "Personalized household preparedness playbook.",
    icon: ShieldCheck,
    inAppPath: "Email fallback (info@mehyar.us) — no accounts on this product",
    whatWeCollect:
      "Email address (to deliver your purchase), the household intake answers you submit (adults, kids, pets, home type, region, budget tier), the generated playbook PDF, and checkout records.",
    whatWeDelete:
      "Email address, household intake answers, generated playbook, and purchase records tied to your email. Deletion via the email fallback within 14 days.",
  },
];

interface Section {
  icon?: any;
  title: string;
  body: React.ReactNode;
}

const sections: Section[] = [
  {
    icon: ShieldCheck,
    title: "What this page is",
    body: (
      <>
        <p>
          MehyarSoft runs a small set of products (<a className="text-brand-700 underline dark:text-brand-100" href="/apps">see the Products page</a>).
          Any product that stores user data exposes a deletion path. This page is the public, plain-English
          summary of those paths and a fallback email channel for users who can&apos;t reach the in-product
          controls.
        </p>
        <p className="mt-2">
          It satisfies the Apple App Store and Google Play store-data-deletion requirements, and it
          mirrors the retention + deletion rules already stated in our{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href="/privacy-policy">Privacy Policy</a>{" "}
          (your data, your call, deletion on request, 14-day window).
        </p>
      </>
    ),
  },
  {
    icon: Trash2,
    title: "How to delete your data from each product",
    body: (
      <>
        <p>
          Every MehyarSoft product exposes the same in-product control, plus this email fallback. Either path
          results in the same outcome: your account and all data tied to it are purged, and you get a
          confirmation email.
        </p>
        <div className="mt-4 grid gap-3">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <div key={app.id} className="rounded-xl border border-border bg-card/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-foreground">{app.name}</h3>
                  <span className="text-sm text-muted-foreground">— {app.tagline}</span>
                  <a
                    className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline dark:text-brand-100"
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {app.url.replace("https://", "")} <ExternalLink className="inline h-3 w-3" />
                  </a>
                </div>
                <dl className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                  <div>
                    <dt className="font-semibold text-foreground">In-product control</dt>
                    <dd className="mt-1">
                      Open the product and go to <code className="rounded bg-muted px-1 py-0.5 text-xs">{app.inAppPath}</code>.
                      Confirm the deletion. The account and all data tied to it are purged immediately
                      and you get an on-screen success message plus a confirmation email.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Email fallback (if you can&apos;t reach the in-product control)</dt>
                    <dd className="mt-1">
                      Send the request from the email address you signed up with to{" "}
                      <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}?subject=${encodeURIComponent(`${app.name} data deletion request`)}`}>
                        {contactEmail}
                      </a>
                      . Include the product name in the subject line. We verify ownership, action the
                      deletion within 14 days, and reply to confirm.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">What we collect from this product</dt>
                    <dd className="mt-1">{app.whatWeCollect}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">What we delete</dt>
                    <dd className="mt-1">{app.whatWeDelete}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </>
    ),
  },
  {
    icon: Clock,
    title: "How long deletion takes",
    body: (
      <>
        <p>
          <strong>In-app:</strong> the deletion runs as part of the request. Most accounts are fully
          purged within a few seconds; any cached rows clear on the next read.
        </p>
        <p className="mt-2">
          <strong>Email requests:</strong> we action the deletion within <strong>14 days</strong> of
          receiving a verifiable request. That window covers manual verification (so a stranger
          can&apos;t delete someone else&apos;s account) and any caches, backups, or analytics tables
          that hold historical rows.
        </p>
        <p className="mt-2">
          We&apos;ll send you a confirmation email at the address you wrote from. If we need more
          information to verify ownership, we&apos;ll reply with a single follow-up question before
          the 14-day clock starts.
        </p>
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: "What happens to backups and logs",
    body: (
      <>
        <p>
          Encrypted backups are rotated on a 30-day cycle. A row that was deleted from the live
          database will roll off the most recent backup within 30 days. System logs that may briefly
          include a request id (not user content) are retained for up to 90 days for security and
          abuse-prevention purposes, and are deleted at the end of that window.
        </p>
        <p className="mt-2">
          We do not sell or share your data with third parties, so there is nothing to retract
          elsewhere.
        </p>
      </>
    ),
  },
  {
    icon: Smartphone,
    title: "App store notes",
    body: (
      <>
        <p>
          <strong>Apple App Store:</strong> the deletion URL on this page is the URL we provide in
          App Store Connect under &ldquo;Account Deletion&rdquo; for each MehyarSoft app that ships
          through TestFlight or the App Store. Apple reviewers can validate the in-app path and the
          email fallback from this page.
        </p>
        <p className="mt-2">
          <strong>Google Play:</strong> the same page satisfies the Data safety form&apos;s
          &ldquo;Data deletion link&rdquo; requirement for each MehyarSoft app published on Google
          Play.
        </p>
      </>
    ),
  },
  {
    icon: Mail,
    title: "Contact and escalation",
    body: (
      <>
        <p>
          Deletion requests, general privacy questions, or concerns that a request has not been
          handled correctly: write to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          . Include the product name and the email address you signed up with.
        </p>
        <p className="mt-2">
          If you have already requested deletion and feel it has been more than 14 days without
          confirmation, reply to the original request email or write again to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}?subject=${encodeURIComponent("Escalation: deletion request pending")}`}>
            {contactEmail}
          </a>{" "}
          with &ldquo;Escalation&rdquo; in the subject line.
        </p>
      </>
    ),
  },
];

const DataDeletion = () => {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-4xl">
        <div className="mb-8">
          <p className="site-eyebrow mb-3">
            {company}
          </p>
          <h1 className="site-display">
            Data Deletion
          </h1>
          <p className="site-lede mt-4 max-w-3xl">
            Request deletion of your data from any MehyarSoft product — Rizza, AiMech, or anything
            else we ship. Use the in-product control or email us. Either way, your account and every
            row tied to it are purged, and we confirm in writing.
          </p>
        </div>
        <div className="space-y-4">
          {sections.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(10,20,24,0.06)] md:p-6"
            >
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-foreground">
                {Icon && <Icon className="h-5 w-5 text-brand-700 dark:text-brand-100" />}
                {title}
              </h2>
              <div className="mt-3 leading-7 text-muted-foreground">{body}</div>
            </article>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-border bg-card/50 p-5 text-sm text-muted-foreground md:p-6">
          <p>
            <strong>Effective date:</strong> July 19, 2026.{" "}
            <strong>Operator:</strong> MehyarSoft LLC.{" "}
            <strong>Contact:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>
            .{" "}
            <strong>Related pages:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/privacy-policy">Privacy Policy</a>,{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/terms">Terms</a>,{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href="/apps">Products</a>.
          </p>
        </div>
      </div>
    </section>
  );
};

export default DataDeletion;
