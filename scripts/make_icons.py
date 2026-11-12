"""Generate the app icons (navy tile with a light-blue barbell).

Run: python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
NAVY = (11, 18, 32)
BLUE = (124, 196, 255)
DEEP = (61, 156, 240)


def icon(size: int) -> Image.Image:
    s = size / 512
    img = Image.new("RGB", (size, size), NAVY)
    d = ImageDraw.Draw(img)
    # bar
    d.rounded_rectangle([96 * s, 244 * s, 416 * s, 268 * s], radius=12 * s, fill=BLUE)
    # plates (outer tall, inner short) on both sides
    for x0, x1, top, bot, col in [
        (112, 150, 168, 344, DEEP),
        (156, 186, 196, 316, BLUE),
        (326, 356, 196, 316, BLUE),
        (362, 400, 168, 344, DEEP),
    ]:
        d.rounded_rectangle([x0 * s, top * s, x1 * s, bot * s], radius=10 * s, fill=col)
    return img


OUT.mkdir(parents=True, exist_ok=True)
icon(512).save(OUT / "icon-512.png")
icon(192).save(OUT / "icon-192.png")
icon(180).save(OUT / "apple-touch-icon.png")
print("icons written to", OUT)
