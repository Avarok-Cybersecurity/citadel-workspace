#!/usr/bin/env python3
"""Draws the disk image's window background, at 1x and 2x, into one TIFF Finder picks from.

    python3 apps/macos-agent/dmg-background.py apps/macos-agent/dmg-background.tiff

Run by hand when the design changes, and the TIFF committed: the release runner has no Pillow, and
a background that cannot be rebuilt the same way twice is not worth generating in CI.

The geometry is dmg-settings.py's: WINDOW, APP_AT and APPLICATIONS_AT are read from there, so the
arrow always points from where the app is to where Applications is.
"""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
BRAND = HERE.parent.parent / "assets" / "brand"
spec = importlib.util.spec_from_file_location("layout", HERE / "dmg-settings.py")
layout = importlib.util.module_from_spec(spec)
layout.defines = {"app": "", "background": ""}  # dmgbuild's globals, so the file imports alone
spec.loader.exec_module(layout)

# The light ground, so the kit's plain (light-ground) lockup; ink and arrow purple are brand.json's onLight values.
GROUND = "#F7F7FA"
ARROW = "#6E59A5"
INK = "#1C1D28"
TAGLINE = "#555766"
FONT = "/System/Library/Fonts/SFNS.ttf"


def draw(scale: int) -> Image.Image:
    w, h = layout.WINDOW
    img = Image.new("RGB", (w * scale, h * scale), GROUND)
    d = ImageDraw.Draw(img)

    logo = Image.open(BRAND / "transparent" / "logo-horizontal-1024.png").convert("RGBA")
    lw = 190 * scale
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    img.paste(logo, ((w * scale - lw) // 2, 34 * scale), logo)

    (ax, ay), (bx, _) = layout.APP_AT, layout.APPLICATIONS_AT
    half = layout.ICON_SIZE // 2 + 26
    x0, x1, y = (ax + half) * scale, (bx - half) * scale, ay * scale
    d.line([(x0, y), (x1 - 14 * scale, y)], fill=ARROW, width=4 * scale)
    d.polygon([(x1, y), (x1 - 18 * scale, y - 11 * scale), (x1 - 18 * scale, y + 11 * scale)], fill=ARROW)

    title = ImageFont.truetype(FONT, 17 * scale)
    body = ImageFont.truetype(FONT, 13 * scale)
    for text, font, colour, top in (
        ("Drag Citadel Agent into Applications", title, INK, 300),
        ("Then open it. It runs in your menu bar and starts when you log in.", body, TAGLINE, 326),
    ):
        tw = d.textlength(text, font=font)
        d.text(((w * scale - tw) / 2, top * scale), text, font=font, fill=colour)
    return img


def main(out: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        one, two = pathlib.Path(tmp, "bg.png"), pathlib.Path(tmp, "bg@2x.png")
        draw(1).save(one, dpi=(72, 72))
        draw(2).save(two, dpi=(144, 144))
        subprocess.run(["tiffutil", "-cathidpicheck", str(one), str(two), "-out", out], check=True)


if __name__ == "__main__":
    main(sys.argv[1])
