#!/usr/bin/env python3
"""Turn-048 build-verification probe. Checks Footer fix landed in new local bundle."""
import re, sys
from pathlib import Path

LOCAL_BUNDLE = Path("dist/public/assets/main-B-K0A4nw.js")
if not LOCAL_BUNDLE.exists():
    print(f"FATAL: local bundle not found at {LOCAL_BUNDLE}")
    sys.exit(2)

b = LOCAL_BUNDLE.read_text(encoding='utf-8', errors='ignore')

# Find Footer Offers list with all 5 labels
sequence = re.compile(r'Tech Audit.*?Website / Booking Cleanup.*?AI Follow-Up Flow.*?Internal Automation Sprint.*?Systems Consulting', re.DOTALL)
matches = list(sequence.finditer(b))
print(f"Footer Offers sequence matches: {len(matches)}")
if matches:
    seg = b[matches[0].start():matches[0].start()+1200]
    print("--- Footer Offers list (built bundle) ---")
    print(seg[:1200])

# Counts
mo = len(re.findall(r'micro-offer#intake', b))
mo_utm = len(re.findall(r'micro-offer#intake&utm', b))
mo_href = len(re.findall(r"""['"`]/micro-offer#intake""", b))
contact = len(re.findall(r"""['"`]/contact[?"`]""", b))
services = len(re.findall(r"""['"`]/services["`]""", b))
print(f"\nCounts in NEW build (main-B-K0A4nw.js):")
print(f"  micro-offer#intake (any context): {mo}")
print(f"  micro-offer#intake (href literal): {mo_href}")
print(f"    of which utm_campaign variants: {mo_utm}")
print(f"    of which plain: {mo_href - mo_utm}")
print(f"  /contact (href literal): {contact}")
print(f"  /services (href literal): {services}")