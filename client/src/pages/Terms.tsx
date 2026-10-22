// Terms.tsx — MehyarSoft LLC terms of service
// Last updated: 2026-10-16. Plain language. Covers every MehyarSoft site and
// product: browsing, accounts, purchases (final sale), subscriptions,
// product-specific disclaimers, and paid consulting engagements.

import { FileText, AlertTriangle, Handshake, ScrollText, Gavel, Mail, ExternalLink, CreditCard, RefreshCw, UserCheck, Sparkles, Ban, Link2 } from "lucide-react";

const company = "MehyarSoft LLC";
const contactEmail = "info@mehyar.us";

interface Section {
  icon?: any;
  title: string;
  body: React.ReactNode;
}

const sections: Section[] = [
  {
    icon: FileText,
    title: "1. Agreement to these terms",
    body: (
      <>
        <p>
          By accessing <a className="text-brand-700 underline dark:text-brand-100" href="https://mehyar.us">mehyar.us</a> or
          any site or product operated by {company} (the &ldquo;sites&rdquo;), creating an account,
          or buying anything from us, you agree to these Terms of Service. If you do not agree,
          do not use the sites.
        </p>
        <p className="mt-2">
          We may update these terms from time to time; the current version is always posted on
          this page with its effective date. Continued use after a posted change means you accept
          the updated terms. Material changes will be announced on the
          <a className="text-brand-700 underline dark:text-brand-100" href="/blog"> blog</a> or
          by email if you are an active customer. See section 18 for the change rules and
          section 19 for how to reach us.
        </p>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "2. Who operates the sites — and what these terms cover",
    body: (
      <>
        <p>
          The sites are operated by <strong>{company}</strong>, a New York limited liability company
          focused on software, systems, automation, and practical tech support for local and
          regulated businesses.
        </p>
        <p className="mt-2">
          <strong>Scope:</strong> these terms cover <em>every</em> site and product {company} operates or
          directly manages, listed below — the marketing site, the product sites, the mobile apps,
          and the tenant sites we host. A product may add its own product-specific notes (in
          section 6 below, on its product page, or in its sign-up flow); where a product-specific
          term conflicts with these terms, the product-specific term controls for that product.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">mehyar.us</div>
            <div className="text-sm text-muted-foreground">Marketing site and operator console for this brand.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Rizza — <a className="text-brand-700 underline dark:text-brand-100" href="https://rizza.app" target="_blank" rel="noreferrer">rizza.app <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI wingman for dating-app conversations. 18+ only.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">AiMech — <a className="text-brand-700 underline dark:text-brand-100" href="https://aimech.app" target="_blank" rel="noreferrer">aimech.app <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI mechanic for everyday car owners.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">BabyPeek — <a className="text-brand-700 underline dark:text-brand-100" href="https://baby.mehyar.us" target="_blank" rel="noreferrer">baby.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI future-baby portraits for adult parents.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">RoastMe — <a className="text-brand-700 underline dark:text-brand-100" href="https://roast.mehyar.us" target="_blank" rel="noreferrer">roast.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI roast cards from your photo.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Crayon Kid — <a className="text-brand-700 underline dark:text-brand-100" href="https://crayonkid.mehyar.us" target="_blank" rel="noreferrer">crayonkid.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Personalized coloring books.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">jobs.mehyar — <a className="text-brand-700 underline dark:text-brand-100" href="https://jobs.mehyar.us" target="_blank" rel="noreferrer">jobs.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Fit-scored career listings.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Stuff Pretty Good — <a className="text-brand-700 underline dark:text-brand-100" href="https://stuffprettygood.com" target="_blank" rel="noreferrer">stuffprettygood.com <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Curated gifts, kits, and digital guides.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Designful — <a className="text-brand-700 underline dark:text-brand-100" href="https://designful.mehyar.us" target="_blank" rel="noreferrer">designful.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI design studio — fixed-price design jobs.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">HustleKit — <a className="text-brand-700 underline dark:text-brand-100" href="https://hustlekit.mehyar.us" target="_blank" rel="noreferrer">hustlekit.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI side-hustle starter kit — personalized playbook PDFs.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Sprint30 — <a className="text-brand-700 underline dark:text-brand-100" href="https://sprint30.mehyar.us" target="_blank" rel="noreferrer">sprint30.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">30-day side-income challenge — daily missions by email.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">BizBuilder — <a className="text-brand-700 underline dark:text-brand-100" href="https://bizbuilder.mehyar.us" target="_blank" rel="noreferrer">bizbuilder.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI business builder — idea to launch-ready plan.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">CreditFix Kit — <a className="text-brand-700 underline dark:text-brand-100" href="https://creditfixkit.mehyar.us" target="_blank" rel="noreferrer">creditfixkit.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">DIY credit repair kit — dispute letters and rebuild plan.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">PLR Vault — <a className="text-brand-700 underline dark:text-brand-100" href="https://plrvault.mehyar.us" target="_blank" rel="noreferrer">plrvault.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Private-label-rights digital product vault — planner pack, content calendar, email swipes, course outlines.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">TrueSketch — <a className="text-brand-700 underline dark:text-brand-100" href="https://truesketch.mehyar.us" target="_blank" rel="noreferrer">truesketch.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Personalized AI portrait sketch + 2-page reading — entertainment only.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">FreelancerOS — <a className="text-brand-700 underline dark:text-brand-100" href="https://freelanceros.mehyar.us" target="_blank" rel="noreferrer">freelanceros.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Freelancer operating system — clients, invoices, content pipeline, templates.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">PromptPack Pro — <a className="text-brand-700 underline dark:text-brand-100" href="https://promptpack.mehyar.us" target="_blank" rel="noreferrer">promptpack.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Niche AI prompt packs + swipe files — 50 prompts, 10 swipes, $19 one-time.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">PrepGuide — <a className="text-brand-700 underline dark:text-brand-100" href="https://prepguide.mehyar.us" target="_blank" rel="noreferrer">prepguide.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Personalized household preparedness playbook — calm, practical, no fear-mongering.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">BeachCall — <a className="text-brand-700 underline dark:text-brand-100" href="https://beachcall.mehyar.us" target="_blank" rel="noreferrer">beachcall.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Daily go/no-go beach verdicts with best-hours windows — free for one beach a day, $9 summer pass for all your beaches.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">PureTap — <a className="text-brand-700 underline dark:text-brand-100" href="https://puretap.mehyar.us" target="_blank" rel="noreferrer">puretap.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Free tap-water safety verdict from EPA data by ZIP — $19 one-time for the full decoded contaminant report.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">TicketBeat — <a className="text-brand-700 underline dark:text-brand-100" href="https://ticketbeat.mehyar.us" target="_blank" rel="noreferrer">ticketbeat.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Free NYC parking-ticket dismissal odds from real DOF appeal data — $9.99 one-time for a tailored dispute letter, $6.99/month covering every ticket.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">FloodLens — <a className="text-brand-700 underline dark:text-brand-100" href="https://floodlens.mehyar.us" target="_blank" rel="noreferrer">floodlens.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Free FEMA flood-zone lookups with plain-English risk and typical insurance costs — $19 one-time for the full 10-page report, $39 for a three-property pack.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">The Mayor — <a className="text-brand-700 underline dark:text-brand-100" href="https://mayor.mehyar.us" target="_blank" rel="noreferrer">mayor.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            {/* PRICING: update when the $39 catalog ships (see ~/workspace/mayor-pilot/pricing-39.diff) */}
            <div className="text-sm text-muted-foreground">AI business assistant for local service businesses — customers, appointments, playbooks, and voice. Free plan; $14/month Pro; one-time credit packs from $4.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Moonroom — <a className="text-brand-700 underline dark:text-brand-100" href="https://moonroom.mehyar.us" target="_blank" rel="noreferrer">moonroom.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI photo studio: studio portraits from one selfie — $24 headshot packs, $15 product-photo studio, $9 theme packs. One-time payments, no subscription.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Audit My Business — <a className="text-brand-700 underline dark:text-brand-100" href="https://mehyar.us/audit/" target="_blank" rel="noreferrer">mehyar.us/audit <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">$330 AI business audit: overall score, money leaks ranked by severity, prioritized fixes, and an AI opportunity map. One-time payment, purchases final.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">DUST — <a className="text-brand-700 underline dark:text-brand-100" href="https://dust.mehyar.us" target="_blank" rel="noreferrer">dust.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Meme-coin experiment: the 7-day Great Sweep distributes 100% of the $DUST supply pro-rata to sweepers — no presale, no insiders. Currently testnet only; nothing for sale. 18+.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Clipnote — <a className="text-brand-700 underline dark:text-brand-100" href="https://clipnote.mehyar.us" target="_blank" rel="noreferrer">clipnote.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Release notes in, a polished 60-second narrated launch video out — free script preview, $29 per video or $19/mo for 4 videos.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Billcut — <a className="text-brand-700 underline dark:text-brand-100" href="https://billcut.mehyar.us" target="_blank" rel="noreferrer">billcut.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Statement audit: upload a bank or card statement and get every recurring charge ranked by yearly cost, with a cancel or negotiation script for each. $9 one-time full audit; $7/month monitoring. No bank login is required; your file is deleted right after it&apos;s read. Optional: after purchase you may connect an account read-only through Stripe Financial Connections — the login happens on Stripe&apos;s hosted window, Billcut never receives bank credentials, only the transactions permission is requested, raw transactions are processed and discarded (only the connection identifier and the audit summary are kept), and you can disconnect anytime from your report page.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Coach — <a className="text-brand-700 underline dark:text-brand-100" href="https://coach.mehyar.us" target="_blank" rel="noreferrer">coach.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI job-search copilot: paste your resume and the job post and Coach tailors the resume to that job (rewritten summary, re-aimed bullets, honest keyword-gap list) and runs STAR interview practice with per-element scores. Free preview; Coach Pro is a $19/month subscription, cancel anytime via the Stripe customer portal. Paste-text intake only — resume and job-post text are stored only behind a private session token and can be deleted in-product at any time. Coach does not guarantee interviews or jobs, and its AI drafts must be reviewed and made true by the user before sending.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Legit — <a className="text-brand-700 underline dark:text-brand-100" href="https://legit.mehyar.us" target="_blank" rel="noreferrer">legit.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI LLC-formation advisor — free name check, filing guidance, and generated documents ($29 session). Self-help software, not a law firm.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">SproutScore — <a className="text-brand-700 underline dark:text-brand-100" href="https://sproutscore.mehyar.us" target="_blank" rel="noreferrer">sproutscore.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">NYC daycare inspection decoder — free center search, $19 full decoded report.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Playbook — <a className="text-brand-700 underline dark:text-brand-100" href="https://playbook.mehyar.us" target="_blank" rel="noreferrer">playbook.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">The 30-Day Content Playbook — free hook teaser, $27 full playbook with posting plan.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">WattWise — <a className="text-brand-700 underline dark:text-brand-100" href="https://wattwise.mehyar.us" target="_blank" rel="noreferrer">wattwise.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Electric-bill checker — free rate gauge from a bill photo, $14.99 full audit, $7.99/mo monitoring.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Memoir — <a className="text-brand-700 underline dark:text-brand-100" href="https://memoir.mehyar.us" target="_blank" rel="noreferrer">memoir.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI-guided memoir interviewer: a 12-chapter interview compiles a storyteller&apos;s own answers into a finished book (web + PDF + print-ready files). Free Sample Chapter; $79 Digital or $149 Complete, one-time — no subscription, purchases are final. Stories live behind a private link, are never used for marketing or sold, and can be deleted in-product at any time. Complete includes print-ready files only — no book is mailed.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Tenant sites</div>
            <div className="text-sm text-muted-foreground">Branded client sites including mehyarmobile.com, stuffprettygood.com, rochelle.love, and white-label hosted PWAs under <code>connectree-*</code> / <code>blue-apple-space-*</code>.</div>
          </li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          For tenant sites, the contracting party is the named tenant operator; {company} acts as
          the technical operator. Tenant-specific questions should be routed through the contact
          page of the relevant site.
        </p>
      </>
    ),
  },
  {
    icon: UserCheck,
    title: "3. Accounts and eligibility",
    body: (
      <>
        <p>
          You must be at least 18 years old — or the age of majority where you live, if higher —
          to create an account, start a subscription, or buy anything on the sites. None of the
          products is directed at children under 13, and we do not knowingly accept accounts or
          purchases from children. Rizza and DUST are 18+ only. BabyPeek is used by adult parents:
          the child pictured in a portrait is the subject, never the user.
        </p>
        <p className="mt-2">
          Some products need an account; others work through a private link, a session token, or
          an email address instead. Where you create an account, give accurate information, keep
          your password and private links to yourself, and do not share, sell, or transfer your
          account or access to anyone else. You are responsible for activity under your account.
          Tell us at{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>{" "}
          if you think your account or a private link has been compromised.
        </p>
        <p className="mt-2">
          Availability can vary by product and over time. We may add, change, or retire products
          and features; section 17 covers how changes are announced.
        </p>
      </>
    ),
  },
  {
    icon: CreditCard,
    title: "4. Purchases, payments — all sales are final",
    body: (
      <>
        <p>
          Paid products are priced in U.S. dollars on their product pages and at checkout. The
          price in the grid above and on each product page is the price for that product unless a
          product page states otherwise. Payment is processed by <strong>Stripe</strong>; your card
          details go to Stripe, not to us, and we never see or store your full card number.
          Checkout is complete when Stripe confirms payment and the product delivers your access,
          download, report, or session.
        </p>
        <p className="mt-2">
          <strong>All purchases are final. We do not offer refunds</strong> — not on one-time purchases
          (reports, audits, packs, kits, portraits, letters, videos, or sessions), not on credit
          packs, and not on subscription periods that have already been paid for. Please use the
          free tiers, previews, and sample outputs most products offer before you buy. If a
          product fails to deliver what you purchased because of a technical error on our side,
          contact us at{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>{" "}
          and we will re-deliver it or restore your access — re-delivery, not a refund, is the remedy.
        </p>
        <p className="mt-2">
          Taxes, where they apply, are calculated and shown at checkout. You are responsible for
          any payment-method fees your bank or card issuer charges.
        </p>
      </>
    ),
  },
  {
    icon: RefreshCw,
    title: "5. Subscriptions, renewals, cancellation, and free trials",
    body: (
      <>
        <p>
          Some products are subscriptions billed through Stripe — for example The Mayor Pro,
          Coach Pro, TicketBeat coverage, Billcut monitoring, WattWise monitoring, and Clipnote
          monthly. A subscription renews automatically at the end of each billing period at the
          then-current price until you cancel. By starting a subscription you authorize Stripe
          to charge your payment method on each renewal.
        </p>
        <p className="mt-2">
          <strong>Cancel anytime.</strong> You can cancel from the product&apos;s billing settings, from
          the Stripe customer-portal link in your receipt or account pages, or by emailing{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          Cancellation stops future renewals; <strong>you keep access until the end of the period you
          have already paid for</strong>, and that paid period is not refunded in whole or in part
          (see section 4). If a payment fails, Stripe may retry it, and access may pause until
          the payment succeeds.
        </p>
        <p className="mt-2">
          <strong>Free trials.</strong> Where a product offers a free trial, the trial length and the
          price that applies afterward are shown at sign-up. If you do not cancel before the
          trial ends, the paid subscription begins automatically through Stripe on the terms
          shown at sign-up. A trial is offered once per customer per product unless the product
          page states otherwise.
        </p>
        <p className="mt-2">
          We may change subscription prices going forward. A price change applies from the next
          renewal after we announce it on the product page or by email; it never changes a period
          you have already paid for.
        </p>
      </>
    ),
  },
  {
    icon: Sparkles,
    title: "6. Product-specific terms and disclaimers",
    body: (
      <>
        <p>
          Many products use artificial intelligence to generate, draft, or assemble output.{" "}
          <strong>AI output can be wrong, incomplete, or out of date.</strong> Review everything before
          you rely on it, send it, file it, or publish it — you are responsible for the decisions
          you make with it. The following notes apply on top of the rest of these terms:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Rizza (18+ only):</strong> AI-drafted conversation help for dating apps. You are responsible for what you choose to send, and for complying with the terms of any dating platform you use.</li>
          <li><strong>AiMech:</strong> diagnostic guidance for everyday car owners. It is not a substitute for a qualified mechanic, and it is not a safety inspection. If a vehicle may be unsafe to drive, stop and get professional help.</li>
          <li><strong>Billcut:</strong> informational statement analysis only. {company} is not a bank, lender, credit counselor, or financial advisor, and an audit does not guarantee that any charge can be cancelled or negotiated down.</li>
          <li><strong>Legit:</strong> self-help software, <strong>not a law firm</strong>. Nothing in Legit is legal advice and no attorney-client relationship is created. You are responsible for reviewing generated documents and for your own filings.</li>
          <li><strong>CreditFix Kit:</strong> a do-it-yourself educational kit. We are not a credit repair organization and we do not provide legal or financial advice; no specific credit-score or dispute outcome is guaranteed.</li>
          <li><strong>Coach:</strong> AI career drafts and practice scoring. Coach does not guarantee interviews, offers, or jobs, and its drafts must be reviewed and made true by you before you send them.</li>
          <li><strong>The Mayor:</strong> an AI business assistant. Its suggestions, drafts, and playbooks are business information, not legal, tax, or financial advice.</li>
          <li><strong>Audit My Business:</strong> an informational report generated from the business details and public signals you provide. It is not professional advice, and purchases are final.</li>
          <li><strong>TicketBeat:</strong> dismissal odds are statistical estimates from public appeal data, not predictions and not legal advice. No outcome on any ticket is guaranteed.</li>
          <li><strong>FloodLens, PureTap, SproutScore, WattWise, BeachCall:</strong> reports decode public data (FEMA, EPA, inspection records, utility bills, forecasts). They are informational summaries — check the official source before making property, health, or money decisions.</li>
          <li><strong>BabyPeek, Moonroom, RoastMe, TrueSketch:</strong> AI-generated portraits, cards, and readings are fictional creations for keepsake and entertainment purposes. A BabyPeek portrait does not predict what an actual child will look like.</li>
          <li><strong>DUST (18+):</strong> an experimental meme-coin project, currently on testnet with nothing for sale. It is not an investment, a security, or financial advice.</li>
          <li><strong>Memoir:</strong> the book is compiled from the storyteller&apos;s own answers; the storyteller is responsible for their content. The Complete tier delivers print-ready files only — no physical book is mailed.</li>
        </ul>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "7. Services offered through these sites",
    body: (
      <>
        <p>
          MehyarSoft offers the following categories of consulting services. Pricing ranges below are
          consultative estimates from the public <a className="text-brand-700 underline dark:text-brand-100" href="/services">services page</a>{" "}
          and are not binding offers.
        </p>
        <ul className="mt-3 space-y-2">
          <li><strong>Tech Audit</strong> — focused review of website, booking path, CRM, call flow, and admin bottlenecks. Typical range: <em>$750&ndash;$2,500</em>.</li>
          <li><strong>Website and Booking Cleanup</strong> — typography, copy, CTAs, booking widget, and trust signals. Typical range: <em>$750&ndash;$2,500</em>.</li>
          <li><strong>AI Missed-Call, SMS &amp; Email Follow-Up Flow</strong> — consent-safe response automation. Typical range: <em>$1,500&ndash;$5,000</em>.</li>
          <li><strong>Internal Automation Sprint</strong> — replace repetitive spreadsheet, inbox, and reporting work. Typical range: <em>$3,000&ndash;$12,000</em>.</li>
          <li><strong>System Architecture &amp; Integration Consulting</strong> — senior engineering support for SaaS, agencies, healthcare, and regulated teams. Typical range: <em>$100&ndash;$175/hr</em> or <em>$5k&ndash;$25k/project</em>.</li>
          <li><strong>Monthly Support Retainer</strong> — ongoing owner support queue. Typical range: <em>$500&ndash;$3,500/mo</em>.</li>
          <li><strong>Custom Software Builds</strong> — internal dashboards, portals, admin tools, and integration layers. Scoped after a discovery or architecture review.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          See <a className="text-brand-700 underline dark:text-brand-100" href="/portfolio">Portfolio</a>{" "}
          for representative engagement patterns.
        </p>
      </>
    ),
  },
  {
    icon: Handshake,
    title: "8. Engagements and statements of work",
    body: (
      <>
        <p>
          Browsing this website does not create a client relationship. Any paid consulting
          engagement with {company} must be scoped separately by a written statement of work
          (&ldquo;SOW&rdquo;) that names deliverables, timeline, assumptions, access needs, pricing,
          payment schedule, and responsibilities of both sides.
        </p>
        <p className="mt-2">
          Until an SOW is signed by both parties, no commitment, exclusivity, deliverable, or
          timeline has been agreed to, regardless of any conversation or proposal shared through
          these sites or by email.
        </p>
      </>
    ),
  },
  {
    icon: AlertTriangle,
    title: "9. Acceptable use of these sites",
    body: (
      <>
        <p>You agree not to:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Use the sites for any unlawful purpose or to violate any applicable laws.</li>
          <li>Attempt to probe, scan, or test the vulnerability of the sites except as permitted by our published security.txt / responsible disclosure terms.</li>
          <li>Send automated traffic (bots, scrapers, credential stuffing) that exceeds reasonable human use of public pages, or abuse product AI features beyond their intended use.</li>
          <li>Submit content through forms that is abusive, defamatory, infringing, deceptive, or that contains malware or unsolicited promotional material.</li>
          <li>Upload or submit content — photos, documents, statements, text — that you do not have the right to use, or that depicts or concerns another person without their permission.</li>
          <li>Share, resell, or transfer your account, subscription, private links, or purchased deliverables to anyone else, except where a product license expressly allows it.</li>
          <li>Misrepresent your identity or business when contacting {company}.</li>
        </ul>
        <p className="mt-2">
          We may block, throttle, or report traffic that violates these rules, and we may delete
          abusive submissions without notice.
        </p>
      </>
    ),
  },
  {
    icon: AlertTriangle,
    title: "10. No sensitive submissions",
    body: (
      <>
        <p>
          Do not submit passwords, API keys, private keys, social security numbers, payment card
          numbers, protected health information, customer lists, source code under embargo, or any
          other confidential or regulated data through public forms, email, or chat on these sites
          unless a private intake channel has been agreed in advance. (A product that is built to
          receive a specific file — for example a Billcut statement or a WattWise bill photo —
          receives only that file, inside that product&apos;s flow.)
        </p>
        <p className="mt-2">
          {company} is not responsible for sensitive data you submit through a public channel,
          and may delete such submissions without further notice.
        </p>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "11. Intellectual property",
    body: (
      <>
        <p>
          The MehyarSoft name, the mehyar.us mark, the product names and marks, blog post text,
          portfolio write-ups, the MehyarSoft city/badge artwork, and the source code of these
          sites are owned by {company} or its licensors and are protected by copyright and
          trademark law.
        </p>
        <p className="mt-2">
          You may reference and link to public pages of these sites for normal business purposes
          (PR, partner pages, case studies) without prior permission. You may not republish full
          articles, scrape the site, or use the MehyarSoft marks to suggest endorsement without our
          written consent. Content sold with private-label rights (PLR Vault) may be used as
          described on its product page; buying any other product gives you a personal license
          to use its deliverables, not ownership of our underlying content, templates, or code.
        </p>
      </>
    ),
  },
  {
    icon: FileText,
    title: "12. Your content",
    body: (
      <>
        <p>
          The content you submit to a product — photos, statements, resumes, business details,
          interview answers, release notes, and similar material — stays yours. You grant{" "}
          {company} a limited, non-exclusive license to host, process, transform, and deliver
          that content <em>only as needed to operate the product for you</em>: turning a photo into a
          portrait, a statement into an audit, a resume and job post into tailored drafts, or
          interview answers into a finished book.
        </p>
        <p className="mt-2">
          You promise that you own or have permission to use everything you submit. We do not
          sell your private content, and we do not use it in marketing without your consent. How
          each product stores and deletes content is described on its product card above, in the{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href="/privacy-policy">Privacy Policy</a>,
          and on the <a className="text-brand-700 underline dark:text-brand-100" href="/data-deletion">Data Deletion</a>{" "}
          page.
        </p>
      </>
    ),
  },
  {
    icon: Link2,
    title: "13. Third-party services",
    body: (
      <>
        <p>
          The products rely on third-party services that have their own terms and privacy
          policies, including: <strong>Stripe</strong> (payments, subscriptions, the customer portal, and
          Stripe Financial Connections where a product offers it), <strong>Cloudflare</strong> (hosting,
          security, and bot protection), <strong>Apple and Google</strong> (app distribution and in-app
          purchases where a product offers a mobile app), the AI model providers that power
          product features, and public data sources such as the EPA, FEMA, the NYC Department of
          Finance, SAM.gov, and Google Places.
        </p>
        <p className="mt-2">
          We are not responsible for third-party services, their availability, or their content.
          If you buy through an app store, that store&apos;s purchase terms also apply to that
          transaction; subscriptions started on the web are managed through Stripe as described
          in section 5.
        </p>
      </>
    ),
  },
  {
    icon: FileText,
    title: "14. Disclaimers",
    body: (
      <>
        <p>
          The information on these sites is provided for general informational purposes about
          {company} and the services and products it offers. It is not legal, medical, financial,
          tax, or compliance advice, and it is not a substitute for engaging {company} under an
          SOW. Product outputs — including AI-generated content and data reports — are covered
          by section 6.
        </p>
        <p className="mt-2">
          The sites and products are provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. To the fullest
          extent permitted by law, {company} disclaims all warranties, express or implied,
          including warranties of merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the sites will be uninterrupted or error-free.
        </p>
      </>
    ),
  },
  {
    icon: Gavel,
    title: "15. Limitation of liability",
    body: (
      <>
        <p>
          To the maximum extent permitted by law, {company}, its members, employees, and
          contractors will not be liable for any indirect, incidental, special, consequential,
          or punitive damages, or any loss of profits or revenues, whether incurred directly or
          indirectly, through your use of (or inability to use) these sites or products.
        </p>
        <p className="mt-2">
          Where liability cannot be excluded, it is limited to the amount you paid {company} in
          the twelve months preceding the claim, or USD $100 if you have not paid anything.
        </p>
      </>
    ),
  },
  {
    icon: Ban,
    title: "16. Termination",
    body: (
      <>
        <p>
          You may stop using the sites at any time, and you may cancel a subscription as
          described in section 5. We may suspend or terminate your access to a site, product, or
          account if you violate these terms, misuse a product, or fail to pay for a paid plan.
          Termination does not refund amounts already paid (section 4) and does not cancel an
          SOW, which ends only under its own terms.
        </p>
        <p className="mt-2">
          Sections that by their nature should survive termination — including intellectual
          property, your-content licenses for work already delivered, disclaimers, limitation of
          liability, and governing law — survive.
        </p>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "17. Governing law and disputes",
    body: (
      <>
        <p>
          These terms are governed by the laws of the State of New York, USA, without regard to
          conflict-of-laws principles. Any dispute arising from or related to these terms or your
          use of these sites will be resolved in the state or federal courts located in New York
          County, New York, and you consent to the personal jurisdiction of those courts.
        </p>
        <p className="mt-2">
          Nothing in this section prevents either party from seeking injunctive relief to protect
          its intellectual property or confidential information.
        </p>
      </>
    ),
  },
  {
    icon: RefreshCw,
    title: "18. Changes to these terms",
    body: (
      <>
        <p>
          We may change these terms as the products evolve. The version posted on this page, with
          its effective date, is the version that applies. If a change materially affects an
          active subscription — for example a price change — it applies from the next renewal
          after the change is announced on the product page or by email, never retroactively to
          a period already paid for. Continuing to use the sites after a change takes effect
          means you accept the updated terms.
        </p>
      </>
    ),
  },
  {
    icon: Mail,
    title: "19. Contact",
    body: (
      <>
        <p>
          Questions about these terms can be sent to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Operated by <strong>{company}</strong>. Business address: 244 96th St APT 1B, Brooklyn, NY 11209.
          Effective October 16, 2026.
        </p>
      </>
    ),
  },
];

const Terms = () => {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-4xl">
        <div className="mb-8">
          <p className="site-eyebrow mb-3">
            {company}
          </p>
          <h1 className="site-display">
            Terms of Service
          </h1>
          <p className="site-lede mt-4">
            Last updated October 16, 2026. These terms cover every MehyarSoft site and product
            listed below — browsing, accounts, purchases, subscriptions, and consulting
            engagements. Reading this website is not a client relationship.
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
            <strong>Effective date:</strong> October 16, 2026.{" "}
            <strong>Operator:</strong> MehyarSoft LLC.{" "}
            <strong>Contact:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </div>
      </div>
    </section>
  );
};

export default Terms;
