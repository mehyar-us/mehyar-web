# turn-001 pwa-manifest · 2026-07-08

## what shipped
PWA install + app-shell offline service worker on mehyar.us.

## files
+ client/public/manifest.webmanifest
+ client/public/sw.js
~ client/index.html (manifest link + theme-color + apple-mobile tags)
~ client/src/main.tsx (SW register gated to mehyar.us/www.mehyar.us)

## deploy
- sha: b413ee6
- branch: improver/pwa-manifest
- merge: --no-ff into main
- CF Pages: live within ~25s of push
- manifest 200 JSON, sw.js 200 JS, home 200 with manifest link

## conversion paths (must not regress)
- /booking: 308 -> 200 (intact)
- /micro-offer: 308 -> 200 (intact)
- /admin, /api/*, /billing/*: explicitly excluded from SW precache
  so form POSTs always hit the network

## kanban
- closed t_a551ae34 (W3-PWA)
- created+done t_80740a4f (deploy record)

## gate items (May 11 acceptance)
- 6 gate items not touched this tick. No regression.

## next-tick candidates
- W4-SEO (Lighthouse + meta pass) — small, high-leverage, doesn't touch conversion
- W2-FUNNEL end-to-end smoke — needed before W5 persuasion
- W1-SLOP — anti-slop copy pass — if W4 doesn't move the needle
