#!/usr/bin/env python3
"""Turn-048 baseline-vs-build diff. The numeric ground truth for the Telegram card."""
import re
from pathlib import Path

LIVE = Path(".hermes/.live_bundle_again.js")
NEW  = Path("dist/public/assets/main-B-K0A4nw.js")

def counts(b):
    mo_href = len(re.findall(r"""['"`]/micro-offer#intake""", b))
    mo_utm  = len(re.findall(r'micro-offer#intake&utm', b))
    contact = len(re.findall(r"""['"`]/contact[?"`]""", b))
    services = len(re.findall(r"""['"`]/services["`]""", b))
    leaka    = b.count('leak ladder')
    techau   = b.count('Tech Audit')
    req330   = b.count('Request the $330 audit')
    return {
        'mo_href':     mo_href,
        'mo_utm':      mo_utm,
        'mo_plain':    mo_href - mo_utm,
        'contact':     contact,
        'services':    services,
        'leak_ladder': leaka,
        'tech_audit':  techau,
        'req_330':     req330,
    }

c_live = counts(LIVE.read_text(encoding='utf-8', errors='ignore'))
c_new  = counts(NEW.read_text(encoding='utf-8', errors='ignore'))

print(f"{'metric':<25} {'live':>8} {'new':>8} {'Δ':>8}")
print('-' * 50)
for k in c_live.keys():
    delta = c_new[k] - c_live[k]
    sign  = '+' if delta > 0 else ''
    print(f"{k:<25} {c_live[k]:>8} {c_new[k]:>8} {sign}{delta:>7}")

# Footer-specific check
def footer_offers(b):
    """Find Footer Offers list with all 5 labels"""
    for m in re.finditer(r'Tech Audit', b):
        seg = b[max(0, m.start()-200):m.start()+2500]
        if all(lbl in seg for lbl in ['Website / Booking Cleanup', 'AI Follow-Up Flow',
                                       'Internal Automation Sprint', 'Systems Consulting']):
            # parse the 5 entries
            list_match = re.search(r'\["Tech Audit","([^"]+)"\],\["Website / Booking Cleanup","([^"]+)"\],\["AI Follow-Up Flow","([^"]+)"\],\["Internal Automation Sprint","([^"]+)"\],\["Systems Consulting","([^"]+)"\]', seg)
            if list_match:
                return list_match.groups()
    return None

print()
print("LIVE Footer Offers:", footer_offers(LIVE.read_text(encoding='utf-8', errors='ignore')))
print("NEW Footer Offers: ", footer_offers(NEW.read_text(encoding='utf-8', errors='ignore')))