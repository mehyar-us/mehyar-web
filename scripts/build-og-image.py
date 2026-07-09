"""
Generate a 1200x630 social-share OG image for mehyar.us.
Run: /c/Python313/python scripts/build-og-image.py
Output: client/public/assets/mehyarsoft-social-1200x630.png
"""
import sys
sys.path = [p for p in sys.path if "hermes" not in p]
from PIL import Image, ImageDraw, ImageFont
import os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "client" / "public" / "assets" / "mehyarsoft-social-1200x630.png"
OUT.parent.mkdir(parents=True, exist_ok=True)

# Brand palette (matches tailwind theme)
BG_TOP = (8, 23, 36)        # near-black navy
BG_BOTTOM = (11, 82, 104)   # brand-700
ACCENT = (102, 210, 235)    # brand-100
INK = (245, 248, 250)
MUTED = (148, 178, 196)
DIVIDER = (255, 255, 255, 38)

W, H = 1200, 630

img = Image.new("RGB", (W, H), BG_TOP)
draw = ImageDraw.Draw(img, "RGBA")

# Vertical gradient
for y in range(H):
    t = y / H
    r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
    g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
    b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# Soft accent glow (top-right)
for i, alpha in enumerate(range(40, 0, -4)):
    r = 80 + i * 6
    draw.ellipse(
        [W - r, -r // 2, W + r // 2, r],
        outline=(ACCENT[0], ACCENT[1], ACCENT[2], alpha),
        width=2,
    )

# Find fonts
def load_font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/SegoeUI-Bold.ttf" if bold else "C:/Windows/Fonts/SegoeUI-Regular.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

font_brand = load_font(38, bold=False)
font_brand_bold = load_font(38, bold=True)
font_h1 = load_font(72, bold=True)
font_sub = load_font(30, bold=False)
font_meta = load_font(22, bold=False)
font_pill = load_font(20, bold=True)

# Left padding / layout
LEFT = 72
TOP = 80

# Brand row
draw.text((LEFT, TOP), "Mehyar", font=font_brand_bold, fill=INK)
mb = draw.textbbox((0, 0), "Mehyar", font=font_brand_bold)
mw = mb[2] - mb[0]
draw.text((LEFT + mw + 4, TOP), "Soft", font=font_brand, fill=ACCENT)
sb = draw.textbbox((0, 0), "Soft", font=font_brand)
sw = sb[2] - sb[0]
tag_x = LEFT + mw + sw + 22
draw.line([(tag_x - 14, TOP + 12), (tag_x - 14, TOP + 36)], fill=(255, 255, 255, 90), width=1)
draw.text((tag_x, TOP + 12), "Software  -  Systems  -  AI", font=font_meta, fill=MUTED)

# Hero headline (two lines, word-wrapped)
h1a = "Stop losing customers to"
h1b = "leaks in your public path."
draw.text((LEFT, TOP + 110), h1a, font=font_h1, fill=INK)
draw.text((LEFT, TOP + 110 + 84), h1b, font=font_h1, fill=INK)

# Subtitle
sub1 = "Founder-led software, systems, and AI automation consulting."
sub2 = "Audit -> fix -> automate -> retain."
draw.text((LEFT, TOP + 320), sub1, font=font_sub, fill=MUTED)
draw.text((LEFT, TOP + 360), sub2, font=font_sub, fill=ACCENT)

# Pill (the offer)
pill_text = "  $150 Tech Audit  -  $330 Audit + Setup  -  Retainers from $500/mo  "
pb = draw.textbbox((0, 0), pill_text, font=font_pill)
pw, ph = pb[2] - pb[0], pb[3] - pb[1]
pill_y = TOP + 420
draw.rounded_rectangle(
    [LEFT - 8, pill_y - 8, LEFT + pw + 24, pill_y + ph + 16],
    radius=24,
    fill=(255, 255, 255, 18),
    outline=(ACCENT[0], ACCENT[1], ACCENT[2], 180),
    width=1,
)
draw.text((LEFT + 8, pill_y), pill_text, font=font_pill, fill=INK)

# Footer (URL + founder mark)
footer_y = H - 64
draw.line([(LEFT, footer_y - 22), (W - LEFT, footer_y - 22)], fill=DIVIDER, width=1)
draw.text((LEFT, footer_y), "mehyar.us", font=font_brand_bold, fill=ACCENT)
draw.text((LEFT + 160, footer_y + 8), "Brooklyn, NY  -  Mehyar Swelim, founder-led", font=font_meta, fill=MUTED)

img.save(OUT, format="PNG", optimize=True)
size_kb = OUT.stat().st_size / 1024
print(f"OK -> {OUT}  ({size_kb:.1f} KB)")