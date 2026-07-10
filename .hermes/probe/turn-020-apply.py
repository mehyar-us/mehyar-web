#!/usr/bin/env python3
"""
turn-020: add /booking JSON-LD (WebPage + BreadcrumbList + FAQPage) to scripts/route-jsonld.json

Mirror of /micro-offer additive pattern. Booking is the second conversion
surface (Tier-5 consultation scheduling) and currently ships zero
route-injected structured data. The runtime SeoManager injects the global
ProfessionalService + FAQPage on hydration, but the FAQPage answers are
general-about-MehyarSoft, not about the booking path itself.

This adds a /booking-specific FAQPage whose Q&A are about the booking
form, the 8 service options, what happens after submit, timezone handling,
confirmation workflow, and the no-fake-slots stance.

Pure additive SEO. Zero copy risk (no React UI change). Idempotent
marker (data-route-jsonld="/booking") handled by scripts/inject-route-jsonld.mjs.
"""
import json
import sys
from pathlib import Path

ROOT = Path(r"C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web")
TARGET = ROOT / "scripts" / "route-jsonld.json"

with TARGET.open(encoding="utf-8") as f:
    data = json.load(f)

if "/booking" in data:
    print(f"/booking already present in route-jsonld.json — aborting")
    sys.exit(1)

data["/booking"] = [
    {
        "@type": "WebPage",
        "@id": "https://mehyar.us/booking#webpage",
        "url": "https://mehyar.us/booking",
        "name": "Request a MehyarSoft consulting call",
        "description": "Service-specific booking request form for MehyarSoft tech audits, $330 rescue, website cleanup, AI follow-up, automation sprints, systems consulting, retainers, and general help.",
        "isPartOf": {"@id": "https://mehyar.us/#website"},
        "about": {"@id": "https://mehyar.us/#professional-service"},
    },
    {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": "https://mehyar.us/",
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": "Book a call",
                "item": "https://mehyar.us/booking",
            },
        ],
    },
    {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is the difference between the booking form and the $330 audit form?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "The booking form on /booking is the consultation-scheduling path: you pick the service you want to discuss and a preferred time window, then MehyarSoft confirms a slot manually. The $330 audit form on /micro-offer is the standalone audit intake: you pay and receive a written leak map. The two routes do not overlap — booking is a conversation request, micro-offer is a paid diagnosis.",
                },
            },
            {
                "@type": "Question",
                "name": "Which service should I pick in the booking form?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Pick the service that names the leak you already see. Tech Audit or $330 Rescue is the right pick if you are not sure where to start. Website cleanup is for owners with traffic but weak conversion. AI follow-up is for missed-call or slow-response patterns. Automation sprint is for teams buried in recurring admin. Systems consulting is for regulated or complex integrations. Retainer is for ongoing technical ownership. General is fine if none of the above names your situation.",
                },
            },
            {
                "@type": "Question",
                "name": "Will MehyarSoft show real available time slots?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "No. MehyarSoft does not display fake open calendar slots. The booking form captures your preferred time window and service, and a real confirmation (manual) follows by email. If live calendar auth is unavailable, the form still works — it just records the request without pretending to reserve a slot.",
                },
            },
            {
                "@type": "Question",
                "name": "How long until MehyarSoft confirms a call?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Most booking requests receive a reply within one business day with two or three concrete time options. Timing is slower over weekends and US holidays. If you have an urgent deadline (campaign launch, integration blocker, regulator visit), mention it in the message field and MehyarSoft will prioritize.",
                },
            },
            {
                "@type": "Question",
                "name": "Is the booking form safe for regulated or PHI-adjacent businesses?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes. The form asks for contact info, service choice, time window, and a short context note. Do not submit passwords, API keys, PHI, payment data, or confidential files through this form — the booking request is reviewed manually and is not the right channel for sensitive payloads. Sensitive material is exchanged on a follow-up channel once the engagement scope is agreed.",
                },
            },
            {
                "@type": "Question",
                "name": "What happens after I submit the booking form?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "MehyarSoft receives the request by email, reviews the chosen service and context, and replies with proposed times. After you confirm a time, you receive a calendar invite. If your situation turns out to be a $330-audit-shaped question instead of a call, MehyarSoft will point you to /micro-offer rather than wasting a meeting slot.",
                },
            },
        ],
    },
]

# Round-trip with sort_keys=False to preserve readable ordering.
with TARGET.open("w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

# Verify by re-loading.
with TARGET.open(encoding="utf-8") as f:
    verify = json.load(f)
assert "/booking" in verify, "/booking key missing after write"
assert len(verify["/booking"]) == 3, f"expected 3 blocks, got {len(verify['/booking'])}"
assert verify["/booking"][2]["@type"] == "FAQPage", "third block not FAQPage"
faqs = verify["/booking"][2]["mainEntity"]
assert len(faqs) == 6, f"expected 6 FAQ entries, got {len(faqs)}"
print(f"✓ wrote {len(faqs)} FAQPage entries for /booking")
print(f"  keys now in route-jsonld.json: {sorted(verify.keys())}")
print(f"  file size: {TARGET.stat().st_size} bytes")