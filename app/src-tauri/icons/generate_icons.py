"""Generate Driftwall app + tray icons from scratch (no third-party assets).

Run from `app/src-tauri/icons`:

    python3 generate_icons.py

Produces the PNGs referenced by `tauri.conf.json`, the tray template, and an
`.icns` bundle built with macOS `iconutil`.
"""

from __future__ import annotations

import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
MASTER = 1024

ACCENT = (91, 140, 255)
ACCENT2 = (143, 107, 255)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def diagonal_gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = (
                lerp(ACCENT[0], ACCENT2[0], t),
                lerp(ACCENT[1], ACCENT2[1], t),
                lerp(ACCENT[2], ACCENT2[2], t),
            )
    return img


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def draw_waves(draw: ImageDraw.ImageDraw, size: int) -> None:
    width = max(2, size // 42)
    amplitude = size * 0.075
    for i, offset in enumerate((-0.12, 0.12)):
        y0 = size * (0.5 + offset)
        pts = []
        steps = 64
        for s in range(steps + 1):
            x = size * (0.16 + 0.68 * (s / steps))
            y = y0 + amplitude * math.sin((s / steps) * math.pi * 2.0 + i)
            pts.append((x, y))
        draw.line(pts, fill=(255, 255, 255), width=width, joint="curve")


def build_app_icon() -> Image.Image:
    base = diagonal_gradient(MASTER).convert("RGBA")
    base.putalpha(rounded_mask(MASTER, radius=int(MASTER * 0.2237)))
    draw = ImageDraw.Draw(base)
    draw_waves(draw, MASTER)
    return base


def build_tray_template(size: int = 44) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    width = max(2, size // 16)
    amplitude = size * 0.16
    for i, offset in enumerate((-0.16, 0.16)):
        y0 = size * (0.5 + offset)
        pts = []
        steps = 40
        for s in range(steps + 1):
            x = size * (0.12 + 0.76 * (s / steps))
            y = y0 + amplitude * math.sin((s / steps) * math.pi * 2.0 + i)
            pts.append((x, y))
        draw.line(pts, fill=(0, 0, 0, 255), width=width, joint="curve")
    return img


def main() -> None:
    master = build_app_icon()
    master.save(HERE / "icon.png")

    master.resize((32, 32), Image.LANCZOS).save(HERE / "32x32.png")
    master.resize((64, 64), Image.LANCZOS).save(HERE / "64x64.png")
    master.resize((128, 128), Image.LANCZOS).save(HERE / "128x128.png")
    master.resize((256, 256), Image.LANCZOS).save(HERE / "128x128@2x.png")

    build_tray_template().save(HERE / "tray-icon-template.png")

    iconset = HERE / "AppIcon.iconset"
    iconset.mkdir(exist_ok=True)
    specs = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for px, name in specs:
        master.resize((px, px), Image.LANCZOS).save(iconset / name)

    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(HERE / "icon.icns")],
        check=True,
    )
    print("icons generated")


if __name__ == "__main__":
    main()
