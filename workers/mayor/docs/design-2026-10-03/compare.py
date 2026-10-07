"""Normalize browser captures and juxtapose QA evidence without changing UI art."""
from pathlib import Path
from PIL import Image, ImageDraw

folder = Path(__file__).parent
source = Image.open(r"C:\Users\mehya\.codex\generated_images\01a103e4-6814-7cb1-88de-7776a2aea746\exec-fd171bc3-1932-4c9e-8eb0-fcfa531b8928.png").convert("RGB")
render = Image.open(folder / "today-desktop-final.jpg").convert("RGB")
print({"source": source.size, "capture": render.size, "cssViewport": [1487, 1058], "dpr": 1})
# The browser excludes scrollbar pixels. Pad the capture; never stretch typography.
normalized = Image.new("RGB", source.size, "white")
normalized.paste(render, (0, 0))
normalized.save(folder / "today-desktop-normalized.png")
combined = Image.new("RGB", (source.width * 2, source.height + 28), "white")
draw = ImageDraw.Draw(combined)
draw.text((12, 7), "Selected visual direction", fill="#102b47")
draw.text((source.width + 12, 7), "Implemented workday / synthetic data", fill="#102b47")
combined.paste(source, (0, 28))
combined.paste(normalized, (source.width, 28))
combined.save(folder / "comparison-final.jpg", quality=95)
# Focus on brand/navigation, headline/attention/agenda, and the shared composer.
regions = [(0, 0, 274, 455), (285, 90, 1455, 450), (285, 850, 1455, 1040)]
width = max((right-left)*2 for left, top, right, bottom in regions)
height = sum(bottom-top+28 for left, top, right, bottom in regions)
focus = Image.new("RGB", (width, height), "white")
draw = ImageDraw.Draw(focus)
y = 0
for idx, (left, top, right, bottom) in enumerate(regions):
    draw.text((12, y+7), f"Region {idx+1}: source / implementation", fill="#102b47")
    a = source.crop((left, top, right, bottom))
    b = normalized.crop((left, top, right, bottom))
    focus.paste(a, (0, y+28))
    focus.paste(b, (a.width, y+28))
    y += a.height+28
focus.save(folder / "comparison-focus.jpg", quality=95)
