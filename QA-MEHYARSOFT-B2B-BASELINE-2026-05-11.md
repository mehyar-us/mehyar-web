# QA — MehyarSoft B2B baseline reputation-risk copy

Generated: 2026-05-11T17:30:17Z
Scope: live site https://mehyar.us and local repo /home/mehya/work/mehyar-web
Project source: /home/mehya/.hermes/projects/mehyarsoft-llc/PROJECT-MEHYARSOFT-LLC.md

## Reality check

The live and local B2B baseline renders and compiles, but it is not reputation-safe yet. The site still mixes the newer true founder story on the home-page embedded about block with older agency-template claims across About, Portfolio, testimonials, blog, footer, and contact. Highest-risk issue: the site presents unverifiable clients, quantified case-study results, named staff/testimonials, a 2015 founding/team-growth timeline, generic social links, and fake newsletter/contact behavior.

## Verification performed

- Live browser QA: https://mehyar.us, /#/about, /#/contact, /#/portfolio/1, /#/privacy-policy.
- Local browser QA: http://127.0.0.1:5000/ after `npm run dev`.
- Source/content review of client/src pages, components, and data files.
- Build gates: `npm run check` passed; `npm run build:client` passed.
- Direct route check: `curl -L https://mehyar.us/services`, `/portfolio`, `/about`, `/contact` returned HTTP 404 because the app uses hash routing/GitHub Pages fallback only for /#/ routes.
- Browser console: no JS errors observed on home or portfolio detail during sampled navigation.

## Prioritized fixes

### P0 — Remove fake/unverifiable social proof before acquisition traffic

1. Delete or replace the fake testimonials carousel.
   - Evidence: `client/src/data/testimonials.ts` lists named customers Sarah Johnson, Michael Roberts, Jennifer Chen, David Wilson, Emily Parker with stock Unsplash avatars and claims like “saving us 100+ hours a month.”
   - Risk: deceptive social proof; high reputation/compliance risk if prospects investigate.
   - Fix: remove the testimonials section entirely until real client approvals exist, or replace with founder/service principles and a “references available on request” style block.

2. Delete or rewrite fake portfolio/case studies.
   - Evidence: `client/src/data/portfolio-projects.ts` claims clients including Global Investment Partners, MedSpecialists Network, Urban Retail Group, TeleHealth Providers, Peterson & Associates, Precision Industries, with quantified results like 85% report-time reduction and 200% more patients.
   - Live evidence: `https://mehyar.us/#/portfolio/1` displays “FinTech Dashboard,” client “Global Investment Partners,” year “2022,” and quantified result section.
   - Risk: unverifiable client/metric claims; especially risky for healthcare/HIPAA and finance positioning.
   - Fix: replace with anonymized “example solution patterns” clearly labeled as examples, or real founder/project work that can be defended. Use “sample engagement” only if not presented as completed client work.

3. Rewrite the About page agency timeline and fake team.
   - Evidence: `client/src/pages/About.tsx` says “Since 2015,” “Expanded our team to 20+ technology professionals,” “Global Expansion,” “Innovation Lab Launch,” “New Headquarters,” and shows fake team members Sarah Johnson, Michael Chen, Emily Davis.
   - Risk: directly conflicts with project founder story: Syrian founder, NYC 15 years, professional engineer 10+ years, married, currently serving a pharma company through MehyarSoft LLC.
   - Fix: make About a founder-led consulting page: Mehyar Swelim, Syrian founder in NYC, 10+ years professional engineering, current systems engineering/pharma credibility, practical business automation. Remove team/headquarters/history claims unless verified.

### P1 — Fix broken/trust-eroding routes and contact paths

4. Footer legal links route to in-app 404 pages.
   - Evidence: footer links `/privacy-policy`, `/terms`, `/sitemap`; App router has no matching routes. Browser confirmed `https://mehyar.us/#/privacy-policy` shows “404 Page Not Found.”
   - Risk: trust/compliance problem, especially if adding forms/newsletter/outbound later.
   - Fix: either add minimal Privacy Policy, Terms, Sitemap pages, or remove links until legal pages exist. Add privacy before any lead capture.

5. Careers link is broken/unwanted.
   - Evidence: About “Join Our Team” links `/careers`; Footer “Careers” links `/contact`; no careers route exists.
   - Risk: reinforces fake-agency/team impression.
   - Fix: remove Careers until hiring exists. Replace with “Work with Mehyar” / “Book an audit.”

6. Direct non-hash routes 404 on live GitHub Pages.
   - Evidence: `curl -L https://mehyar.us/services`, `/portfolio`, `/about`, `/contact` returned 404; only `/#/services` etc. render.
   - Risk: shared links or SEO crawlers using clean URLs break.
   - Fix: keep hash links intentionally and add sitemap/canonical handling, or deploy a Pages fallback/Cloudflare Worker rewrite if clean URLs are desired.

7. Contact inbox mismatch.
   - Evidence: project source lists contact inbox `mrswelim@gmail.com`; Contact page and contact-section mailto use `info@mehyar.us`.
   - Risk: lost leads if `info@mehyar.us` is not configured/monitored.
   - Fix: confirm forwarding or update all visible/mailto contact paths to a monitored inbox/domain alias. Do not print or commit secrets.

### P1 — Stop fake lead-capture behavior

8. Footer newsletter gives a success toast without sending/storing anything.
   - Evidence: `client/src/components/Footer.tsx` `handleSubscribe` shows “Subscribed! You've been added to our newsletter list.” then clears input; no backend call.
   - Risk: deceptive UX and lost consent/audit trail.
   - Fix: remove newsletter form until Cloudflare-native intake exists, or change copy to “Coming soon.” When implemented: Turnstile, consent checkbox, privacy link, suppression/audit logging.

9. Blog sidebar newsletter has no submit handler.
   - Evidence: `client/src/pages/Blog.tsx` renders a Subscribe form but no `onSubmit`.
   - Risk: user can submit but nothing happens; trust erosion.
   - Fix: remove or wire to same compliant intake endpoint.

10. Home contact form only opens mail client and discards state.
   - Evidence: `client/src/components/contact-section.tsx` builds a mailto to `info@mehyar.us`, shows “Opening email client,” then resets the form.
   - Risk: users without a configured mail client lose the lead; no server-side record, no audit, no source attribution.
   - Fix: Cloudflare Pages/Worker intake with Turnstile, validation, lead storage, email notification, and clear success/error states.

### P2 — Update outdated/thin content before SEO/indexing

11. Blog content is stale 2023 template content under fake authors.
   - Evidence: `client/src/data/blog-posts.ts` has posts dated Jan–Jun 2023 with authors Sarah Johnson, Michael Roberts, Jennifer Chen, etc.
   - Risk: old/fake content makes the brand look abandoned and generic.
   - Fix: hide Blog for now or replace with 2–3 founder-authored, 2026-relevant pages: local business tech audit checklist, missed-call follow-up, CRM cleanup, regulated-system integration notes.

12. Generic technology breadth may over-position the business.
   - Evidence: Services and project data imply Angular, Azure, AWS, Kubernetes, TensorFlow, FHIR, IoT, Power BI, etc. across many verticals.
   - Risk: looks like an agency-template instead of credible founder-led consulting.
   - Fix: narrow to defendable offers from project source: website cleanup/landing/booking, missed-call/SMS/email follow-up, internal automation sprint, systems/integration consulting, monthly support.

### P2 — UX polish / information architecture

13. Home page has one good founder block but conflicts with other pages.
   - Evidence: `client/src/components/about-section.tsx` aligns well with founder story: Syrian founder, NYC, 15 years, professional software engineer, systems/AI automation. But About page contradicts it with fake agency history/team.
   - Fix: promote this founder positioning into the primary About page and hero; remove conflicting generic agency claims.

14. Footer social links are generic platform homepages.
   - Evidence: footer points to `https://linkedin.com`, `https://twitter.com`, `https://facebook.com`, `https://github.com`.
   - Risk: users click and leave to generic sites; signals unfinished/fake brand.
   - Fix: replace with real profile URLs or remove social icons.

15. Page titles can remain stale after 404 navigation.
   - Evidence: after visiting `/#/about`, navigating to `/#/privacy-policy` displayed 404 while browser title remained “About Us | MehyarSoft.”
   - Risk: minor UX/SEO signal of unfinished routing.
   - Fix: set NotFound document.title to “Page Not Found | MehyarSoft.”

## Recommended next copy structure

- Hero: “Practical websites, CRM cleanup, and automation for businesses losing customers to missed calls, bad follow-up, and disconnected systems.”
- Proof: “10+ years professional software/systems engineering,” “NYC-based,” “currently serving regulated/pharma systems through MehyarSoft LLC” if approved.
- Offers: local business tech audit, website/booking cleanup, AI missed-call/SMS/email flow, internal automation sprint, system architecture/integration consulting, monthly support.
- Replace “Our Work” with “Common leaks I fix” until real case studies are approved.
- Replace testimonials with “Founder-led, no software theater” credibility block.
- Contact CTA: “Request a quick audit” with privacy/consent-safe intake.

## Acceptance status

- Live baseline reviewed: complete.
- Local baseline reviewed: complete.
- Reputation-risk copy flagged: complete.
- Broken routes/UX issues flagged: complete.
- Prioritized fixes returned: complete.
