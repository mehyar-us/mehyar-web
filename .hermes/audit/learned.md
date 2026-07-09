# learned.md

> rolling 1-line additions; append-only.

- 2026-07-09 turn-025: /newsletter WebPage + BreadcrumbList + FAQPage JSON-LD (18 schema routes).
- 2026-07-09 turn-026: /404 WebPage + BreadcrumbList JSON-LD (19 schema routes). The 404 shell is a single file at `dist/public/404.html`, not a directory — added a small `/404` fallback branch to `scripts/inject-route-jsonld.mjs` so the existing `dist/public/<route>/index.html` pattern handles the special case without breaking the other 18 routes. Reusable scripts: `add-404-jsonld.py` (JSON append) + `patch-inject-route-jsonld-404.py` (idempotent injector patch). Lesson: every public route should ship at least WebPage + BreadcrumbList, including 404 — the surface that catches broken inbound links is exactly where you don't want crawlers seeing schema-less markup. Deploy sha a3d386c, build green, test:intake green, cross-route 10/10 unchanged.