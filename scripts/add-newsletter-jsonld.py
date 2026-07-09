"""Add /newsletter route-injected JSON-LD (WebPage + BreadcrumbList + FAQPage)
to scripts/route-jsonld.json without disturbing any existing indentation,
key order, or CRLF endings. Idempotent (skips if /newsletter key exists).
"""
import json
import sys
from pathlib import Path

p = Path('scripts/route-jsonld.json')
data = json.loads(p.read_text(encoding='utf-8'))

if '/newsletter' in data:
    print('SKIP: /newsletter already present')
    sys.exit(0)

newsletter_block = [
    {
        "@type": "WebPage",
        "@id": "https://mehyar.us/newsletter#webpage",
        "url": "https://mehyar.us/newsletter",
        "name": "Free AI Automation Checklist | MehyarSoft",
        "description": "A practical free checklist for local businesses and regulated teams that want to find website, booking, missed-call, and follow-up leaks before committing to software work.",
        "isPartOf": {"@id": "https://mehyar.us/#website"},
        "about": {"@id": "https://mehyar.us/#professional-service"},
        "primaryImageOfPage": {
            "@type": "ImageObject",
            "url": "https://mehyar.us/assets/mehyarsoft-social-1200x630.png",
            "width": 1200,
            "height": 630
        }
    },
    {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://mehyar.us/"},
            {"@type": "ListItem", "position": 2, "name": "Free AI Automation Checklist", "item": "https://mehyar.us/newsletter"}
        ]
    },
    {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is the MehyarSoft AI automation checklist?",
                "acceptedAnswer": {"@type": "Answer", "text": "A short, practical checklist for local businesses and regulated teams that want to find website, booking, missed-call, and follow-up leaks before committing to software work. Four questions: where visitors hesitate before contacting you, whether missed calls and emails become tracked follow-up, what manual copy-paste work an AI or system workflow could remove, and which safe automation ideas are worth piloting versus risky shortcuts."}
            },
            {
                "@type": "Question",
                "name": "Who is the checklist for?",
                "acceptedAnswer": {"@type": "Answer", "text": "Owners and operators of local service businesses, agencies, clinics, restaurants, shops, and regulated teams who suspect leads are leaking through bad website flow, missed calls, weak follow-up, or disconnected tools, and want a senior technical operator's framing before scoping a build or paying for software."}
            },
            {
                "@type": "Question",
                "name": "Is the checklist really free, and will I get spammed?",
                "acceptedAnswer": {"@type": "Answer", "text": "Yes, the checklist is free. One focused email path delivers it, followed by occasional practical updates when there is something genuinely useful to share. No fake urgency, no rented-list follow-ups, and no third-party marketing. Unsubscribe lives at /unsubscribe."}
            },
            {
                "@type": "Question",
                "name": "How is the checklist different from the $330 audit?",
                "acceptedAnswer": {"@type": "Answer", "text": "The checklist is a self-serve set of questions any owner can run against their own business in a short sitting. The $330 audit at /micro-offer is a paid, founder-led review of your specific website, booking, missed-call, and follow-up paths, delivered as a written action plan. The checklist helps you decide whether you need the audit; the audit tells you what to actually fix first."}
            },
            {
                "@type": "Question",
                "name": "Is the signup safe for regulated or PHI-adjacent businesses?",
                "acceptedAnswer": {"@type": "Answer", "text": "Yes. The signup form asks for an email address and a name only. Do not submit passwords, API keys, PHI, payment data, or confidential files here. The newsletter list is used for the checklist and occasional practical updates, never sold, never shared."}
            },
            {
                "@type": "Question",
                "name": "What happens after I sign up?",
                "acceptedAnswer": {"@type": "Answer", "text": "You receive the checklist by email within a few minutes, along with a one-click unsubscribe in every message. After the checklist, the natural next step for businesses with a confirmed leak is the $330 audit at /micro-offer; the natural next step for a software build question is /booking. Neither is required."}
            }
        ]
    }
]

data['/newsletter'] = newsletter_block

# Write back with same line endings the file had. Detect newline from existing content.
raw = p.read_bytes()
nl = b'\r\n' if b'\r\n' in raw else b'\n'

# json.dumps with indent=2 — match existing file
out = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
p.write_bytes(out.encode('utf-8').replace(b'\n', nl) if nl == b'\r\n' else out.encode('utf-8'))

# Validate
json.loads(p.read_text(encoding='utf-8'))
print(f"OK: /newsletter added ({len(newsletter_block)} blocks), file size now {p.stat().st_size} bytes")