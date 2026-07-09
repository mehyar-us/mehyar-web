"""Patch scripts/inject-route-jsonld.mjs so /404 also gets its route-injected
JSON-LD block. The current injector only handles dist/public/<route>/index.html;
the 404 page is a single file at dist/public/404.html, so we replace the
"if (!existsSync(target)) continue;" line with a smarter check that falls
back to the .html file when the directory form is absent (and the route is /404).

Idempotent — running twice is a no-op (checks for the marker comment).
"""
from pathlib import Path
import sys

repo = Path('.')
inj = repo / 'scripts' / 'inject-route-jsonld.mjs'
src = inj.read_text(encoding='utf-8')

MARKER = '// /404 fallback (turn-026):'
if MARKER in src:
    print('SKIP: /404 fallback already present in inject-route-jsonld.mjs')
    sys.exit(0)

# Replace the early-exit line with a smarter check:
#   1. if target exists, fall through to the existing flow (unchanged behavior)
#   2. if target does NOT exist AND route is /404 AND fallback (404.html) exists,
#      inject into the fallback file, then `continue` past the existing flow
#   3. otherwise continue (unchanged behavior)
needle = (
    "  const target = join(distDir, route.replace(/^\\//, ''), 'index.html');\n"
    "  if (!existsSync(target)) continue;\n"
)
replacement = (
    "  const target = join(distDir, route.replace(/^\\//, ''), 'index.html');\n"
    "  if (!existsSync(target)) {\n"
    "    // /404 fallback (turn-026): the 404 page is a single file, not a directory.\n"
    "    if (route === '/404') {\n"
    "      const fallback = join(distDir, '404.html');\n"
    "      if (existsSync(fallback)) {\n"
    "        const altMarker = `data-route-jsonld=\"${route}\"`;\n"
    "        const altHtml = readFileSync(fallback, 'utf8');\n"
    "        if (!altHtml.includes(altMarker)) {\n"
    "          const altPayload = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);\n"
    "          const altScript = `<script type=\"application/ld+json\" ${altMarker}>\\n    ${altPayload}\\n    </script>`;\n"
    "          const altNext = altHtml.includes('</head>')\n"
    "            ? altHtml.replace('</head>', `    ${altScript}\\n  </head>`)\n"
    "            : `${altScript}\\n${altHtml}`;\n"
    "          writeFileSync(fallback, altNext);\n"
    "          injectedCount += 1;\n"
    "          console.log(`  + /404 -> 404.html (fallback)`);\n"
    "        }\n"
    "      }\n"
    "    }\n"
    "    continue;\n"
    "  }\n"
)

if needle not in src:
    print('ERROR: target-line pattern not found — manual update required')
    sys.exit(1)

new_src = src.replace(needle, replacement, 1)
inj.write_text(new_src, encoding='utf-8')
print('OK: /404 fallback patched into inject-route-jsonld.mjs')
print(f'   new file size: {inj.stat().st_size} bytes')