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
          MehyarSoft also runs and helps manage a small portfolio of internal sites and apps —
          see the <a className="text-brand-700 underline dark:text-brand-100" href="/apps">Apps</a>{" "}
          and <a className="text-brand-700 underline dark:text-brand-100" href="/services">Services</a>{" "}
          pages. This notice covers all of them under one consistent policy.
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
          <strong>We do not collect:</strong> payment data (handled directly by Stripe in their checkout
          iframe — MehyarSoft servers never see your card number), government identifiers, protected
          health information, biometric data, or anything that should not be sent through a public web form.
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
          This site is intentionally low-cookie. The only persistent client-side storage in current use is:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code>localStorage["darkMode"]</code> — remembers your light/dark theme preference. No personal data.
          </li>
          <li>
            <code>sessionStorage["mehyarsoft_admin_token"]</code> — used only by the
            owner-only <code>/admin</code> dashboard so the admin UI does not log you out on every
            refresh. Cleared when you log out or close the tab.
          </li>
          <li>
            A short-lived sidebar <code>sidebar_state</code> cookie on admin pages. Not used by the
            public site.
          </li>
        </ul>
        <p className="mt-2">
          <strong>Analytics:</strong> At the time of this writing there is no third-party analytics
          script loaded on this site. Aggregate traffic visibility comes from Cloudflare&apos;s
          server-side request logs, which we can read but do not share. If we ever add an analytics
          provider we will update this page first.
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
    title: "Apps and sites we operate",
    body: (
      <>
        <p>
          {company} operates or directly manages the following sites and apps. The same data-handling
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
            <div className="font-semibold">Tenant sites (white-label)</div>
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
          This site is a business consulting offering. It is not directed to children under 16, and
          we do not knowingly collect data from children. If you believe a child has submitted
          information through a form, email <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>
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
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            {company}
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
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
