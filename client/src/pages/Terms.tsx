// Terms.tsx — MehyarSoft LLC website terms of service
// Last updated: 2026-07-18. Plain language. Separates web browsing from paid engagements.

import { FileText, AlertTriangle, Handshake, ScrollText, Gavel, Mail, ExternalLink } from "lucide-react";

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
          any site operated by {company} (the &ldquo;sites&rdquo;), you agree to these Terms of Service.
          If you do not agree, do not use the sites.
        </p>
        <p className="mt-2">
          We may update these terms from time to time. Continued use after a posted change means
          you accept the updated terms. Material changes will be announced on the
          <a className="text-brand-700 underline dark:text-brand-100" href="/blog"> blog</a> or
          by email if you are an active contact.
        </p>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "2. Who operates the sites",
    body: (
      <>
        <p>
          The sites are operated by <strong>{company}</strong>, a New York limited liability company
          focused on software, systems, automation, and practical tech support for local and
          regulated businesses.
        </p>
        <p className="mt-2">{company} also operates or directly manages these sites and apps. The
          same baseline terms apply to all of them; each tenant or product may publish its own
          end-user terms linked from its own footer or sign-up flow.
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
            <div className="font-semibold">Tenant sites</div>
            <div className="text-sm text-muted-foreground">Branded client sites including mehyarmobile.com, stuffprettygood.com, rochelle.love, and white-label hosted PWAs under <code>connectree-*</code> / <code>blue-apple-space-*</code>.</div>
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "3. Services offered through these sites",
    body: (
      <>
        <p>
          MehyarSoft offers the following categories of services. Pricing ranges below are
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
    title: "4. Engagements and statements of work",
    body: (
      <>
        <p>
          Browsing this website does not create a client relationship. Any paid engagement with
          {company} must be scoped separately by a written statement of work (&ldquo;SOW&rdquo;) that
          names deliverables, timeline, assumptions, access needs, pricing, payment schedule, and
          responsibilities of both sides.
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
    title: "5. Acceptable use of these sites",
    body: (
      <>
        <p>You agree not to:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Use the sites for any unlawful purpose or to violate any applicable laws.</li>
          <li>Attempt to probe, scan, or test the vulnerability of the sites except as permitted by our published security.txt / responsible disclosure terms.</li>
          <li>Send automated traffic (bots, scrapers, credential stuffing) that exceeds reasonable human use of public pages.</li>
          <li>Submit content through forms that is abusive, defamatory, infringing, deceptive, or that contains malware or unsolicited promotional material.</li>
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
    title: "6. No sensitive submissions",
    body: (
      <>
        <p>
          Do not submit passwords, API keys, private keys, social security numbers, payment card
          numbers, protected health information, customer lists, source code under embargo, or any
          other confidential or regulated data through public forms, email, or chat on these sites
          unless a private intake channel has been agreed in advance.
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
    title: "7. Intellectual property",
    body: (
      <>
        <p>
          The MehyarSoft name, the mehyar.us mark, blog post text, portfolio write-ups, the
          MehyarSoft city/badge artwork, and the source code of these sites are owned by {company} or
          its licensors and are protected by copyright and trademark law.
        </p>
        <p className="mt-2">
          You may reference and link to public pages of these sites for normal business purposes
          (PR, partner pages, case studies) without prior permission. You may not republish full
          articles, scrape the site, or use the MehyarSoft marks to suggest endorsement without our
          written consent.
        </p>
      </>
    ),
  },
  {
    icon: FileText,
    title: "8. Disclaimers",
    body: (
      <>
        <p>
          The information on these sites is provided for general informational purposes about
          {company} and the consulting services it offers. It is not legal, medical, financial,
          tax, or compliance advice, and it is not a substitute for engaging {company} under an
          SOW.
        </p>
        <p className="mt-2">
          The sites are provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. To the fullest
          extent permitted by law, {company} disclaims all warranties, express or implied,
          including warranties of merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the sites will be uninterrupted or error-free.
        </p>
      </>
    ),
  },
  {
    icon: Gavel,
    title: "9. Limitation of liability",
    body: (
      <>
        <p>
          To the maximum extent permitted by law, {company}, its members, employees, and
          contractors will not be liable for any indirect, incidental, special, consequential,
          or punitive damages, or any loss of profits or revenues, whether incurred directly or
          indirectly, through your use of (or inability to use) these sites.
        </p>
        <p className="mt-2">
          Where liability cannot be excluded, it is limited to the amount you paid {company} in
          the twelve months preceding the claim, or USD $100 if you have not paid anything.
        </p>
      </>
    ),
  },
  {
    icon: ScrollText,
    title: "10. Governing law and disputes",
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
    icon: Mail,
    title: "11. Contact",
    body: (
      <>
        <p>
          Questions about these terms can be sent to{" "}
          <a className="text-brand-700 underline dark:text-brand-100" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Operated by <strong>{company}</strong>. Effective July 18, 2026.
        </p>
      </>
    ),
  },
];

const Terms = () => {
  return (
    <section className="bg-background px-4 pb-16 pt-28 md:pb-20 md:pt-32">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            {company}
          </p>
          <h1 className="text-4xl font-semibold tracking-[-0.04em] text-ink dark:text-white md:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Last updated July 18, 2026. These terms keep website browsing and paid consulting
            engagement boundaries separate. Reading this website is not a client relationship.
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
      </div>
    </section>
  );
};

export default Terms;
