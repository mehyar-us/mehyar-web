# AI Command Center hierarchy audit

Date: 2026-08-28  
Viewport checked: 390 x 844

## Verdict

OpenClaw and Hermes had useful content, but the commercial hierarchy hid it. The homepage did not name either product, and industry pages placed the first meaningful explanation after the complete pricing deck and customer journey.

## Changes made

1. Added **Meet your AI command center** as the homepage’s primary action.
2. Added a full homepage section immediately after the hero explaining the offer in business language before comparing OpenClaw and Hermes.
3. Added direct AI-use links for every supported industry group.
4. Added an industry-specific command-center preview immediately below every industry hero and sticky section navigation.
5. Made **AI command center** the first sticky page destination, ahead of services and pricing.
6. Added four business-specific examples above pricing and retained the full ten-use-case comparison and managed pricing below.
7. Added direct links to the complete AI comparison, installation pricing, and booking flow.
8. Hid the native horizontal scrollbar on the mobile sticky section navigation.

## Verification

- All ten industry groups show OpenClaw, Hermes Agent, four tailored preview tasks, the complete ten-use-case section, and AI installation pricing.
- Every industry preview appears before its services and pricing section in the document order.
- The homepage contains ten direct industry AI links.
- The homepage AI CTA, one industry link, and the full-use-case link were exercised at mobile width.
- TypeScript and the production build passed.

## Remaining considerations

- The terms OpenClaw and Hermes are intentionally secondary to the plain-language value proposition; most buyers will understand “AI business command center” faster than product names.
- Actual integrations, autonomous actions, and business outcomes still depend on approved tools, permissions, consent, data quality, and human review.
- The production JavaScript bundle remains above the preferred size threshold and should be code-split in a future performance pass.

## Evidence

- `01-before-home-mobile.png` — homepage before either assistant was named.
- `02-before-barber-top-mobile.png` — industry entry before AI promotion.
- `03-before-barber-ai-section-mobile.png` — useful content buried after pricing.
- `04-after-home-ai-mobile.png` — new homepage AI Command Center section.
- `06-after-home-top-mobile.png` — AI Command Center as the primary homepage action.
- `07-after-barber-ai-fixed-mobile.png` — industry-specific preview before pricing.
- `08-after-barber-full-ai-details-mobile.png` — direct link into the complete ten-use-case section.
- `09-live-home-ai-mobile.png` — production homepage verification.
- `10-live-barber-ai-mobile.png` — production industry hierarchy verification.
