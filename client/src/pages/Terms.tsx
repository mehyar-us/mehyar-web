// Terms.tsx — MehyarSoft LLC website terms of service
// Last updated: 2026-10-03. Plain language. Separates web browsing from paid engagements.

import { FileText, AlertTriangle, Handshake, ScrollText, Gavel, Mail, ExternalLink } from "lucide-react";
import { MayorAutomaticAuditTerms } from "@/components/MayorAutomaticAudit";

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
        <p className="mt-2">{company} also operates or directly manages these sites and products. The
          same baseline terms apply to all of them; each tenant or product may publish its own
          end-user terms linked from its own footer or sign-up flow.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">mehyar.us</div>
            <div className="text-sm text-muted-foreground">Marketing site and operator console for this brand.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">The Mayor — <a className="text-brand-700 underline dark:text-brand-100" href="https://mayor.mehyar.us" target="_blank" rel="noreferrer">mayor.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">A separate signed-in business workspace. Its account, billing and usage terms are published in the product. Public website conversations do not access or sync to that account.</div>
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
            <div className="font-semibold">mehyar.jobs — <a className="text-brand-700 underline dark:text-brand-100" href="https://jobs.mehyar.us" target="_blank" rel="noreferrer">jobs.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
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
            <div className="font-semibold">TikTok Growth System — <a className="text-brand-700 underline dark:text-brand-100" href="https://tiktokgrowth.mehyar.us" target="_blank" rel="noreferrer">tiktokgrowth.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">AI-generated organic short-form growth playbook.</div>
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
            <div className="text-sm text-muted-foreground">Niche AI prompt packs and swipe files. Confirm current products and prices on the product site.</div>
          </li>
          <li className="rounded-xl border border-border bg-card/60 p-3">
            <div className="font-semibold">PrepGuide — <a className="text-brand-700 underline dark:text-brand-100" href="https://prepguide.mehyar.us" target="_blank" rel="noreferrer">prepguide.mehyar.us <ExternalLink className="inline h-3 w-3" /></a></div>
            <div className="text-sm text-muted-foreground">Personalized household preparedness playbook — calm, practical, no fear-mongering.</div>
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
          MehyarSoft builds custom AI, software and connected workflows around each business.
          Custom project pricing, delivery and ongoing costs require an agreed scope and written
          statement of work. See the current <a className="text-brand-700 underline dark:text-brand-100" href="/pricing">pricing page</a>{" "}
          for published product prices and how custom work is scoped.
        </p>
        <ul className="mt-3 space-y-2">
          <li><strong>Website review</strong> — a $330 founder-led audit or a $5 automated report, with the scope and delivery described on the relevant product page.</li>
          <li><strong>Website and booking experience</strong> — content, navigation, booking and installable web apps.</li>
          <li><strong>Custom business AI</strong> — approved knowledge, response drafts and connected workflows with agreed permissions and human review.</li>
          <li><strong>Internal automation</strong> — spreadsheet, inbox, reporting and operational handoffs, scoped around the team's existing tools.</li>
          <li><strong>System architecture and integrations</strong> — engineering support for local businesses, technology and enterprise teams.</li>
          <li><strong>Ongoing support</strong> — monitoring, maintenance and improvements under an agreed support scope.</li>
          <li><strong>Custom Software Builds</strong> — internal dashboards, portals, admin tools, and integration layers. Scoped after a discovery or architecture review.</li>
        </ul>
        <p className="mt-3">
          The Mayor's Free plan is $0 USD/month with 100 assistant reply attempts and 10 app microphone
          minutes per business per calendar month. Pro is $14 USD/month with 1,000 attempts and
          120 app microphone minutes per verified paid period. Allowances are shared by the business;
          failed attempts and reserved microphone time may count. There are no automatic overage charges.
          Phone-provider charges, third-party services and custom implementation are separate.
          Choose a plan in the private workspace after signing in; paid access requires verified payment.
        </p>
        <p className="mt-3">
          Authorized owners and managers can configure the Business agent. Goals, reusable skills and
          working-style instructions belong to the business; review schedules and reports belong to
          the operator. Goal measurements are entered manually; progress is calculated from them.
          Custom skills are instructions with selected
          read permissions. Scheduled reviews start paused and require an explicit opt-in. Each manual
          or scheduled AI planning attempt uses one shared business reply attempt; a report produced
          within an authorized chat turn uses that already-counted turn. Reports are draft recommendations;
          saving a suggested task requires separate review and confirmation. Planning reports do not send
          messages, publish content, take payments or change calendars.
        </p>
        <p className="mt-3">
          Optional one-time usage packs add 200 reply attempts and 15 app microphone minutes for $4,
          500 and 45 for $8, or 800 and 90 for $12. Extra usage belongs to the selected business and
          expires when its current usage period ends or changes, including a plan upgrade or downgrade:
          the UTC calendar month for Free or the verified paid period for Pro. Packs do not transfer to
          a new period or plan, roll over, or renew automatically. A refund or payment dispute removes
          the pack allowance; past usage remains counted. Buy a pack
          in the signed-in workspace; credits are available only after payment is verified.
        </p>
        <MayorAutomaticAuditTerms/>
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
          Operated by <strong>{company}</strong>. Effective October 3, 2026.
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
            Last updated October 3, 2026. These terms keep website browsing and paid consulting
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

