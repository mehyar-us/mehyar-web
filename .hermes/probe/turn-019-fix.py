#!/usr/bin/env python3
"""
turn-019: navbar CTA funnel realignment
======================================
Closes a leak left by W2-FUNNEL closure (turn-004/005/006/009):
the Navbar's persistent 'Book a Tech Audit' button (visible on every
public page via MainLayout) still points to /contact, the slowest
funnel. Hero, pricing, About, Blog CTAs were all moved to
/micro-offer#intake but the navbar was missed.

Change is purely a href swap (copy unchanged: 'Book a Tech Audit').
Pure additive funnel realignment — zero copy risk, zero visual risk.
"""
import sys
from pathlib import Path

ROOT = Path(r"C:/Users/mehya/OneDrive/Documents/GitHub/mehyar-web")
TARGET = ROOT / "client/src/components/Navbar.tsx"

src = TARGET.read_text(encoding="utf-8")

# Three matches: 2 distinct button occurrences (desktop + mobile) each render
# <Link href="/contact" ... > with a "Book a Tech Audit" label.
# Each 'Book a Tech Audit' label sits immediately before a closing </Link>
# tag — uniqueness check on the surrounding context (the href line) is the
# cleanest contract.
NEW_DESKTOP_BLOCK = (
    '<Link href="/micro-offer#intake" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "hidden rounded-full px-4 lg:inline-flex")}>\n'
    '              Book a Tech Audit'
)
NEW_MOBILE_BLOCK = (
    '<Link\n'
    '                href="/micro-offer#intake"\n'
    '                className={cn(buttonVariants({ variant: "cta" }), "mt-2 w-full")}\n'
    '                onClick={() => setIsMobileMenuOpen(false)}\n'
    '              >\n'
    '                Book a Tech Audit'
)

OLD_DESKTOP_BLOCK = (
    '<Link href="/contact" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "hidden rounded-full px-4 lg:inline-flex")}>\n'
    '              Book a Tech Audit'
)
OLD_MOBILE_BLOCK = (
    '<Link\n'
    '                href="/contact"\n'
    '                className={cn(buttonVariants({ variant: "cta" }), "mt-2 w-full")}\n'
    '                onClick={() => setIsMobileMenuOpen(false)}\n'
    '              >\n'
    '                Book a Tech Audit'
)

# Apply desktop
if OLD_DESKTOP_BLOCK not in src:
    print("NOT FOUND: desktop Navbar CTA block")
    sys.exit(1)
src = src.replace(OLD_DESKTOP_BLOCK, NEW_DESKTOP_BLOCK, 1)
print("✓ desktop navbar CTA: /contact → /micro-offer#intake")

# Apply mobile
if OLD_MOBILE_BLOCK not in src:
    print("NOT FOUND: mobile Navbar CTA block")
    sys.exit(1)
src = src.replace(OLD_MOBILE_BLOCK, NEW_MOBILE_BLOCK, 1)
print("✓ mobile navbar CTA: /contact → /micro-offer#intake")

# Sanity: no remaining '/contact' Book a Tech Audit pair on Navbar (we still
# want the navlink label "Contact" itself to remain — that's a different line)
remain = []
for i, line in enumerate(src.splitlines(), 1):
    if 'href="/contact"' in line and i < 200:
        remain.append((i, line))
print(f"\nremaining /contact href lines (top 200): {len(remain)}")
for ln, txt in remain:
    print(f"  L{ln}: {txt.strip()}")

TARGET.write_text(src, encoding="utf-8")
print("\n✓ wrote Navbar.tsx")