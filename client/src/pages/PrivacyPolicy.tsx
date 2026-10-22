// PrivacyPolicy.tsx — MehyarSoft LLC public privacy notice
// Last updated: 2026-07-18. Plain language, owner-scoped, no tracking by default.

import { Shield, Mail, FileLock2, AlertCircle, ServerCog, ExternalLink } from "lucide-react";

const contactEmail = "info@mehyar.us";
const company = "MehyarSoft LLC";

interface Section {
  icon?: any;
  title: string;
  body: React.ReactNode;
}

const sections: Section[] = [
  {
    icon: Shield,
    title: "Who we are",
    body: (
      <>
        <p>
          This website (<a className="text-brand-700 underline dark:text-brand-100" href="https://mehyar.us">mehyar.us</a>) and
          the related MehyarSoft services are operated by <strong>{company}</strong>, a New York-based
          consulting practice focused on software, systems, automation, and practical tech support
          for local and regulated businesses.
        </p>
        <p className="mt-2">
          MehyarSoft also runs and helps manage a small portfolio of internal sites and products —
          see the <a className="text-brand-700 underline dark:text-brand-100" href="/apps">Products</a>{" "}
          and <a className="text-brand-700 underline dark:text-brand-100" href="/services">Services</a>{" "}
          pages. This notice covers all of them under one consistent policy.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Business address: 244 96th St APT 1B, Brooklyn, NY 11209. Contact:{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </>
    ),
  },
  {
    icon: FileLock2,
    title: "What we collect",
    body: (
      <>
        <p>
          <strong>You give us:</strong> name, email, company or business name, website, business context,
          the problem you are trying to solve, and (optionally) a phone number or preferred contact method
          — only when you submit a contact form, request a quote or audit, sign up for the newsletter,
          or reply to one of our emails.
        </p>
        <p className="mt-2">
          <strong>We do not collect:</strong> card numbers or live online payment data. Invoices are handled
          manually by email, with ACH, wire, check, or cash details confirmed only after scope is accepted.
          Do not send government identifiers, protected health information, biometric data, or anything
          that should not be sent through a public web form.
        </p>
        <p className="mt-2">
          <strong>Do not submit:</strong> passwords, API keys, private keys, secrets, social security
          numbers, financial statements, or confidential client data through this site. A private
          intake channel will be agreed separately before any engagement that requires it.
        </p>
      </>
    ),
  },
  {
    icon: ServerCog,
    title: "Where the data is stored",
    body: (
      <>
        <p>
          This site runs on <strong>Cloudflare Pages and Workers</strong>, with form submissions and
          lead records stored in <strong>Cloudflare D1</strong> (a serverless SQLite-compatible
          database hosted in Cloudflare&apos;s network). Some inbound email forwarding is handled by
          Cloudflare Email Routing on the mehyar.us zone. Outbound transactional email is sent through
          the Cloudflare Email Service.
        </p>
        <p className="mt-2">
          For richer planning tasks we may also pull publicly-available business signals from
          third-party sources like the U.S. Small Business Administration registry, SAM.gov
          (U.S. federal contract opportunities), and Google Places / business listings.
          Those lookups are run on demand against the public APIs of those providers and only the
          public result rows are stored.
        </p>
      </>
    ),
  },
  {
    icon: Shield,
    title: "What we use it for",
    body: (
      <>
        <p>We use the information you submit to:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Respond to consulting requests, scope potential work, and send the deliverables you asked for.</li>
          <li>Maintain basic business records (invoices, quotes, status updates).</li>
          <li>Detect abuse, spam, and bot traffic on forms (Cloudflare Turnstile; see below).</li>
          <li>Honor opt-out and suppression requests, including List-Unsubscribe on outgoing email.</li>
        </ul>
        <p className="mt-2">
          <strong>What we do not do:</strong> we do not sell contact submissions, we do not share
          your inquiry with third-party ad networks, and we do not run behavior-tracking scripts
          on this site. We do not embed Facebook Pixel, Google Ads conversion tags, or similar.
        </p>
      </>
    ),
  },
  {
    icon: FileLock2,
    title: "Cookies, localStorage, and analytics",
    body: (
      <>
        <p>
          This site is intentionally low-cookie. The persistent client-side storage in use is:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code>localStorage[&quot;darkMode&quot;]</code> — remembers your light/dark theme preference. No personal data.
          </li>
          <li>
            <code>localStorage[&quot;ms_cookie_consent&quot;]</code> — remembers your cookie-consent choice
            (accepted/declined) so we don&apos;t ask on every visit.
          </li>
          <li>
            <code>sessionStorage[&quot;mehyarsoft_admin_token&quot;]</code> — used only by the
            owner-only <code>/admin</code> dashboard so the admin UI does not log you out on every
            refresh. Cleared when you log out or close the tab.
          </li>
          <li>
            A short-lived sidebar <code>sidebar_state</code> cookie on admin pages. Not used by the
            public site.
          </li>
          <li>
            A first-party visitor cookie, <code>mh_vid</code> — a random visitor identifier (no
            name, no account information) set by our own analytics, described below. It lasts up
            to one year.
          </li>
        </ul>
        <p className="mt-2">
          <strong>Analytics:</strong> Our own analytics is first-party: we operate it ourselves,
          its data is stored in our own systems, and it is never sold. It records pages viewed,
          links and buttons clicked, time engaged with a page, and — on our product sites —
          funnel steps such as starting a checkout or completing a purchase, tied to the{" "}
          <code>mh_vid</code> visitor identifier. Events are sent to our own collection endpoint
          at <code>mayor.mehyar.us</code>. Collection honors Do Not Track and Global Privacy
          Control signals, and stops if you decline cookies/analytics where a site offers that
          choice. This site also loads <strong>Google Analytics 4</strong> (measurement ID{" "}
          <code>G-25N8E18944</code>), which sets <code>_ga</code> cookies —{" "}
          <strong>only after you click &quot;Accept&quot; on our cookie banner</strong>; if you
          click &quot;Decline,&quot; it does not load. Separately, aggregate traffic visibility
          comes from Cloudflare&apos;s server-side request logs, which we can read but do not
          share. You can also opt out of Google Analytics entirely with{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
            Google&apos;s opt-out add-on
          </a>
          .
        </p>
      </>
    ),
  },
  {
    icon: Shield,
    title: "Bot protection (Cloudflare Turnstile)",
    body: (
      <>
        <p>
          Contact, newsletter, and quote forms use <strong>Cloudflare Turnstile</strong> — a
          privacy-conscious challenge that runs in your browser to verify you are a real person
          before accepting a submission. Turnstile does not track you across other sites and we do
          not receive a profile of your device; we only receive a one-time pass/fail token per
          submission.
        </p>
      </>
    ),
  },
  {
    icon: Mail,
    title: "Email and follow-up",
    body: (
      <>
        <p>
          If you request help, {company} may reply by email about that request and may follow up
          with status, scheduling, or delivery information. Every outbound campaign email contains
          a working <code>List-Unsubscribe</code> header (RFC 8058 one-click) so you can opt out in
          one click without a login.
        </p>
        <p className="mt-2">
          You can also ask not to be contacted again at any time by emailing{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>,
          or by visiting the <a className="text-brand-700 underline dark:text-brand-100" href="/unsubscribe">unsubscribe page</a>.
          That preference is recorded before any further outreach.
        </p>
      </>
    ),
  },
  {
    icon: ServerCog,
    title: "Products and sites we operate",
    body: (
      <>
        <p>
          {company} operates or directly manages the following sites and products. The same data-handling
          rules apply to all of them; each may have its own end-user terms linked from its footer.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">mehyar.us</div>
            <div className="text-sm text-muted-foreground">Marketing site and operator console for this brand.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Rizza — <a className="text-brand-700 underline dark:text-brand-100" href="https://rizza.app" target="_blank" rel="noreferrer">rizza.app <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI wingman for dating-app conversations.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">AiMech — <a className="text-brand-700 underline dark:text-brand-100" href="https://aimech.app" target="_blank" rel="noreferrer">aimech.app <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI mechanic for everyday car owners.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">BabyPeek — <a className="text-brand-700 underline dark:text-brand-100" href="https://baby.mehyar.us" target="_blank" rel="noreferrer">baby.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI future-baby portraits.</div>
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
<div className="font-semibold">PromptPack Pro — <a className="text-brand-700 underline dark:text-brand-100" href="https://promptpack.mehyar.us" target="_blank" rel="noreferrer">promptpack.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Niche AI prompt packs + swipe files — 50 prompts, 10 swipes, $19 one-time.</div>          </li>
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
            <div className="text-sm text-muted-foreground">AI business assistant for local service businesses — customers, appointments, playbooks, and voice. Free plan; $99/month Pro; one-time credit packs from $4.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Moonroom — <a className="text-brand-700 underline dark:text-brand-100" href="https://moonroom.mehyar.us" target="_blank" rel="noreferrer">moonroom.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI photo studio: studio portraits from one selfie — $49 headshot packs, $39 product-photo studio, $29 theme packs. One-time payments, no subscription.</div>
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
            <div className="text-sm text-muted-foreground">Statement audit: upload a bank or card statement and get every recurring charge ranked by yearly cost, with a cancel or negotiation script for each. $9 one-time full audit; $7/month monitoring. No bank login is required; your file is deleted right after it's read. Optional: after purchase you may connect an account read-only through Stripe Financial Connections — the login happens on Stripe's hosted window, Billcut never receives bank credentials, only the transactions permission is requested, raw transactions are processed and discarded (only the connection identifier and the audit summary are kept), and you can disconnect anytime from your report page.</div>
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
            <div className="text-sm text-muted-foreground">AI-guided memoir interviewer: a 12-chapter interview compiles a storyteller's own answers into a finished book (web + PDF + print-ready files). Free Sample Chapter; $79 Digital or $149 Complete, one-time — no subscription. We collect only the storyteller's name and relationship, the buyer's email, and the interview answers; stories live behind a private link, are never used for marketing or sold, and can be deleted in-product at any time. Complete includes print-ready files only — no book is mailed.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">ValleyGods — <a className="text-brand-700 underline dark:text-brand-100" href="https://valleygods.mehyar.us" target="_blank" rel="noreferrer">valleygods.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">A living AI town of 150 Minimes — free to watch, read their Mindlogs, or sign in to occupy one. Free, no paid tier.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">Visakit — <a className="text-brand-700 underline dark:text-brand-100" href="https://visakit.mehyar.us" target="_blank" rel="noreferrer">visakit.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI tourist-visa application preparation — five routes live, any route on request, $39 per pack ($29 early-bird for the first 25 packs). Preparation help only; visa decisions belong to the consulate.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">            <div className="font-semibold">Tenant sites (white-label)</div>
            <div className="text-sm text-muted-foreground">Branded client sites including mehyarmobile.com, stuffprettygood.com, rochelle.love, and selected hosted-PWA tenants under <code>connectree-*</code> / <code>blue-apple-space-*</code> namespaces.</div>
          </li>
        </ul>
        <p className="mt-3">
          For each tenant site the data controller is the named tenant operator; {company} acts as the
          technical processor. Tenant-specific privacy questions should be routed through the contact
          page of the relevant site.
        </p>
      </>
    ),
  },
  {
    icon: AlertCircle,
    title: "Data retention and deletion",
    body: (
      <>
        <p>
          Contact-form submissions are kept while the conversation is active and for up to 24 months
          afterward for support continuity, then deleted unless we have an active engagement with you.
          Audit log events are kept for 90 days. Suppression / opt-out records are kept indefinitely
          so we never re-email an unsubscribed contact.
        </p>
        <p className="mt-2">
          You can request deletion of your contact-form submission or quote record at any time by
          emailing <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>
          from the same address. We will confirm completion within 14 days.
        </p>
      </>
    ),
  },
  {
    icon: Shield,
    title: "Your rights",
    body: (
      <>
        <p>Regardless of where you are located, you can ask to:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Access the personal data we hold about you.</li>
          <li>Correct inaccurate data.</li>
          <li>Delete your data (subject to retention rules above).</li>
          <li>Opt out of any further outreach.</li>
        </ul>
        <p className="mt-2">
          Send requests to <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </>
    ),
  },
  {
    icon: Shield,
    title: "Children&apos;s privacy",
    body: (
      <>
        <p>
          This site is a business consulting offering. It is not directed to children under 13 (or
          under 16), and we do not knowingly collect data from children. If you believe a child has
          submitted information through a form, email <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>
          and we will delete it.
        </p>
      </>
    ),
  },
  {
    icon: Mail,
    title: "Changes to this policy",
    body: (
      <>
        <p>
          We will post the updated date at the top of this page when this policy changes. Material
          changes (such as adding a third-party analytics provider) will also be announced in the
          <a className="text-brand-700 underline dark:text-brand-100" href="/blog"> blog</a> or by email if you are an active contact.
        </p>
        <p className="mt-2">
          Questions or privacy requests: <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </>
    ),
  },
];

const PrivacyPolicy = () => {
  return (
    <section className="site-hero">
      <div className="site-shell max-w-4xl">
        <div className="mb-8">
          <p className="site-eyebrow mb-3">
            {company}
          </p>
          <h1 className="site-display">
            Privacy Policy
          </h1>
          <p className="site-lede mt-4">
            Last updated July 18, 2026. This page is intentionally plain-language and owner-safe —
            no behavior tracking, no third-party ad scripts, no surveillance by default.
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
            <strong>Effective date:</strong> July 18, 2026.{" "}
            <strong>Operator:</strong> MehyarSoft LLC.{" "}
            <strong>Contact:</strong>{" "}
            <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </div>
      </div>
    </section>
  );
};

export default PrivacyPolicy;

