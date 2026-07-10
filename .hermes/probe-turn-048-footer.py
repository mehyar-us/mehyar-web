#!/usr/bin/env python3
"""Turn-048 footer probe. Counts audit-intent micro-offer#intake hrefs in live bundle.
Per-loop rule: re-verify counts in same turn before stating them."""
import re, sys
from pathlib import Path

BUNDLE = Path(".hermes/.live_bundle.js")
if not BUNDLE.exists():
    print(f"FATAL: bundle not found at {BUNDLE}")
    sys.exit(2)

b = BUNDLE.read_text(encoding='utf-8', errors='ignore')

# micro-offer#intake as href literal in any quote style
mo_href = len(re.findall(r"""['"`]/micro-offer#intake""", b))
mo_any = len(re.findall(r'micro-offer#intake', b))
mo_utm = len(re.findall(r'micro-offer#intake&utm', b))
print(f"micro-offer#intake (any context):       {mo_any}")
print(f"micro-offer#intake (href literal):      {mo_href}")
print(f"  of which utm_campaign variants:       {mo_utm}")
print(f"  of which plain /micro-offer#intake:   {mo_href - mo_utm}")

# /contact
contact_href = len(re.findall(r"""['"`]/contact[?"`]""", b))
print(f"/contact (href literal):                {contact_href}")

# /services
services_href = len(re.findall(r"""['"`]/services["`]""", b))
print(f"/services (href literal):               {services_href}")

# Find the Footer block specifically — Tech Audit followed by up to 700 chars
m = re.search(r'Tech Audit[\s\S]{0,800}', b)
if m:
    seg = m.group(0)
    print("\n--- Footer 'Tech Audit' context (first 800 chars) ---")
    # Trim to a representative segment
    print(seg[:800])

# Find /services in Footer Offers — count AFTER 'Tech Audit' label
print("\n--- hrefs in Footer Offers area (first Tech Audit block) ---")
m = re.search(r'Tech Audit[\s\S]{0,800}', b)
if m:
    seg = m.group(0)
    hrefs = re.findall(r"""['"`](/[a-z\-]+(?:#[a-z]+)?(?:\?[a-z=&_]*)?)['"`]""", seg)
    print(f"hrefs found: {hrefs}")