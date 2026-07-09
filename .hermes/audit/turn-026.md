# turn-026 — /404 JSON-LD

**tick_id:** 26
**date:** 2026-07-09T16:05:30Z
**branch:** improver/404-jsonld-turn-026
**sha:** a3d386c (merge)
**deploy:** https://mehyar.us/404 (live, 3 JSON-LD blocks)

## Picked

The 404 page (`dist/public/404.html`) was the last public route with zero
route-injected JSON-LD blocks. Every other public route in
`scripts/route-jsonld.json` had at least WebPage + BreadcrumbList — `/404`
served only the runtime ProfessionalService + FAQPage from SeoManager
(no /404-specific @graph). For crawlers that don't execute JS, the 404
surface looked schema-less.

## Change

1. `scripts/route-jsonld.json` — added `/404` key with WebPage
   (#webpage, "Route not found | MehyarSoft", description matching the
   shell) + BreadcrumbList (Home > Route not found). No FAQPage
   (404 is an error surface, not a question hub). Reuses same @id
   cross-references (`#website`, `#professional-service`) as the rest
   of the graph.
2. `scripts/inject-route-jsonld.mjs` — added a `/404` fallback branch.
   The current injector only handles `dist/public/<route>/index.html`
   directory-shaped shells; `/404` is a single file at
   `dist/public/404.html`. When `target` doesn't exist AND `route === '/404'`,
   the script writes the @graph into the fallback file (idempotent via
   the `data-route-jsonld="/404"` marker).
3. `scripts/add-404-jsonld.py` — companion script for the JSON file
   append (CRLF-preserving, indent=2, key-ordered, idempotent).
4. `scripts/patch-inject-route-jsonld-404.py` — companion script for
   the injector patch (idempotent — checks for the marker comment).

## Verification

- `npm run build:client` → green, "Injected per-route JSON-LD into 19
  shell(s)" + "  + /404 -> 404.html (fallback)".
- `dist/public/404.html` → 3 `application/ld+json` blocks (was 2).
- `npm run test:intake` → green.
- Live `https://mehyar.us/404` → 200, 3 blocks (was 2); new block
  carries `data-route-jsonld="/404"` marker.
- Cross-route smoke (10 sibling routes): all 200 / 308 → 200, all
  still serving the same JSON-LD block count as before. Zero
  regressions.

## Risk

Zero-copy change. The injector fallback is additive — when route is
not `/404`, the early-exit behavior is byte-identical to the pre-patch
script. The `/404` JSON entry follows the same format as `/newsletter`
(key style, @id pattern, isPartOf/about cross-refs).

## Voice

No copy changed — the @graph reuses the existing `<title>` and
`<meta description>` text from the 404 shell verbatim.

## Numbers

- 19 routes now schema-equipped (was 18 in turn-025).
- Diff: 4 files, +169 / -1.
- Deploy sha: a3d386c (merge), underlying feature commit 53f0aa1.
