# Mobile navigation and homepage audit

Date: 2026-08-28  
Viewports checked: 320 x 568, 390 x 844, and 1440 x 900

## What was wrong

1. The mobile tabs labeled **Businesses** and **Pricing** pointed to the same `/pricing` page. They looked like separate destinations but did not provide separate information.
2. The homepage opened with a customer-system pitch and immediately repeated six industry pricing cards. It felt like a second pricing directory instead of an agency homepage.
3. Important mobile destinations—services, work, and contact—were hidden behind the menu while a support action occupied permanent bottom-navigation space.
4. The Services page embedded the same industry-pricing explorer used by Pricing, further weakening the distinction between the two destinations.
5. The homepage did not clearly show that MehyarSoft also builds custom CRMs, internal platforms, APIs, data systems, cloud backends, AI systems, and DevOps infrastructure.
6. At 320 px wide, the full wordmark competed with Help, theme, and menu controls in the header.

## Changes made

1. Replaced the four-item mobile bar with five distinct destinations: **Home**, **Solutions**, **Industries**, **Work**, and **Contact**.
2. Moved Support out of the bottom bar. It remains directly available through the top **Help** button, full navigation menu, and footer.
3. Consolidated desktop and menu navigation into **Solutions** and **Industries & pricing**, removing the misleading Businesses/Pricing duplication.
4. Rewrote the homepage hero to cover both customer growth systems and custom engineering.
5. Replaced homepage pricing cards with two clear paths: systems for growing businesses and engineering for teams or enterprises.
6. Added a compact industry finder without prices; detailed plans and prices remain on the Industries page.
7. Removed the industry-pricing explorer from the Solutions page. Solutions now owns the capability catalog; Industries owns vertical examples and prices.
8. Hid the wordmark text below 361 px so the narrow-phone header remains usable.

## Verification

- All five mobile tabs were clicked at phone width and reached unique destinations with the correct active state.
- Solutions contains the offer catalog and no industry-search control.
- Industries contains industry search and no offer catalog.
- The homepage, solution paths, pricing page, and narrow-phone header were visually inspected.
- TypeScript and production build completed successfully.

## Remaining conversion weaknesses

These are outside this focused navigation change but still worth addressing next:

1. The homepage has no verified customer logos, named testimonials, or quantified case studies, so the promise is broader than the proof.
2. The Work page describes engagement patterns rather than clearly labeled completed client work; this is honest, but less persuasive.
3. The Industries page is still content-dense and could use a sticky category filter before the long directory.
4. The hero image is polished but generic; a short product montage showing a booking app, CRM, and internal dashboard would communicate range faster.
5. “Book a strategy call” and “Start” are clear, but the site still needs stronger expectation-setting about response time and what happens after submission.

## Evidence

- `before-home-mobile.png` — duplicated pricing-first homepage and four-item navigation.
- `before-pricing-mobile.png` — Businesses and Pricing shown as separate tabs on the same route.
- `after-home-mobile-top.png` — broader homepage hero and five distinct tabs.
- `after-home-mobile-solutions.png` — two-path customer-growth / enterprise-engineering section.
- `after-pricing-mobile.png` — Industries active as the sole industry-and-pricing destination.
- `after-home-mobile-320-fixed.png` — narrow-phone header and five-tab navigation.
- `after-home-desktop.png` — consolidated desktop navigation and broader homepage positioning.
- `live-home-mobile.png` — production verification after the Cloudflare Pages release.
