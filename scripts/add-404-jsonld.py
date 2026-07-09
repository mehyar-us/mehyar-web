"""Add /404 route-injected JSON-LD (WebPage + BreadcrumbList) to
scripts/route-jsonld.json. The 404 page is intentionally minimal —
no FAQPage (it's an error surface, not a question hub) and no ItemList
(nothing to enumerate). Mirrors the file-format preservation rules
from add-newsletter-jsonld.py: detect CRLF, indent=2, ensure_ascii=False,
keep existing key order, append new key at the end.

Idempotent (skips if /404 key exists).
"""
import json
import sys
from pathlib import Path

p = Path('scripts/route-jsonld.json')
data = json.loads(p.read_text(encoding='utf-8'))

if '/404' in data:
    print('SKIP: /404 already present')
    sys.exit(0)

# Keep the /404 entry small. WebPage (with @id, no JSON-LD inside it)
# + BreadcrumbList that returns the visitor to home + sitemap.
notfound_block = [
    {
        "@type": "WebPage",
        "@id": "https://mehyar.us/404#webpage",
        "url": "https://mehyar.us/404",
        "name": "Route not found | MehyarSoft",
        "description": "That MehyarSoft route does not exist. Return to the homepage or browse the public sitemap.",
        "isPartOf": {"@id": "https://mehyar.us/#website"},
        "about": {"@id": "https://mehyar.us/#professional-service"}
    },
    {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://mehyar.us/"},
            {"@type": "ListItem", "position": 2, "name": "Route not found", "item": "https://mehyar.us/404"}
        ]
    }
]

data['/404'] = notfound_block

raw = p.read_bytes()
nl = b'\r\n' if b'\r\n' in raw else b'\n'
out_bytes = (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
if nl == b'\r\n':
    out_bytes = out_bytes.replace(b'\n', b'\r\n')

p.write_bytes(out_bytes)

# Validate
json.loads(p.read_text(encoding='utf-8'))
print(f"OK: /404 added ({len(notfound_block)} blocks), file size now {p.stat().st_size} bytes")