"""
Add WebPage + BreadcrumbList to the home entry in scripts/route-jsonld.json.
Preserves CRLF line endings and 2-space indent (matches existing file style).
Idempotent: detects existing WebPage/BreadcrumbList and skips.
"""
import json
from pathlib import Path

p = Path('scripts/route-jsonld.json')
raw = p.read_bytes()

# Parse (python json accepts LF or CRLF)
data = json.loads(raw.decode('utf-8'))

current_types = [x.get('@type') for x in data['/']]
print(f'Current home types: {current_types}')

if 'WebPage' in current_types and 'BreadcrumbList' in current_types:
    print('WebPage + BreadcrumbList already present on home — no-op.')
    raise SystemExit(0)

webpage = {
    "@type": "WebPage",
    "@id": "https://mehyar.us/#webpage",
    "url": "https://mehyar.us/",
    "name": "MehyarSoft LLC | NYC Software & AI Automation Consultant",
    "description": "Founder-led software, systems, and AI automation consulting for local businesses, agencies, and regulated teams losing customers to missed calls, weak websites, manual work, and disconnected tools.",
    "isPartOf": {"@id": "https://mehyar.us/#website"},
    "about": {"@id": "https://mehyar.us/#professional-service"},
    "primaryImageOfPage": {
        "@type": "ImageObject",
        "url": "https://mehyar.us/assets/mehyarsoft-social-1200x630.png",
        "width": 1200,
        "height": 630
    }
}
breadcrumb = {
    "@type": "BreadcrumbList",
    "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://mehyar.us/"}
    ]
}

# Insert WebPage + BreadcrumbList BEFORE the existing ItemList (preserves ItemList ordering for ItemListEntry blog posts).
data['/'] = [webpage, breadcrumb] + data['/']

new_text = json.dumps(data, indent=2, ensure_ascii=False)
# Force CRLF to match existing file convention
new_bytes = new_text.replace('\n', '\r\n').encode('utf-8')

print(f'Old: {len(raw)} bytes, New: {len(new_bytes)} bytes, delta: {len(new_bytes) - len(raw):+d}')
print(f'New home types: {[x.get("@type") for x in data["/"]]}')

p.write_bytes(new_bytes)
print('Written.')