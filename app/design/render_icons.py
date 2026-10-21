#!/usr/bin/env python3
"""Render Driftwall's app + tray icons from the design SVGs.

Source of truth:
  app/design/logo.svg  -> app icon (transparent, 824px tile)
  app/design/tray.svg  -> menu-bar template icon (black, no tile)

macOS QuickLook (`qlmanage`) rasterises SVG, but flattens it onto an opaque
white background. We therefore rebuild a clean antialiased alpha channel:

  * App icon: the artwork is opaque exactly inside a known rounded rectangle
    (100px margin, 824px tile, r=185.4), so the alpha mask is computed
    analytically from that geometry and the white backdrop is discarded.
  * Tray icon: the artwork is pure black on white, so per-pixel alpha is
    recovered exactly as `255 - luminance`; colour is forced to black.

Requires only Pillow (already present) plus the macOS `qlmanage`/`iconutil`
tools. Run from anywhere:

    python3 app/design/render_icons.py
"""

from __future__ import annotations

import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "src-tauri" / "icons"

MASTER = 1024
# Rounded-rect tile geometry in the 1024 master canvas (from logo.svg).
LEFT = 100.0
TILE = 824.0
RADIUS = 36.0 * 5.15  # = 185.4
TILE_RGB = (10, 10, 16)  # #0A0A10


def rasterize(svg: Path, size: int, workdir: Path) -> Image.Image:
    """Render `svg` to a `size`x`size` RGBA PNG via QuickLook (white backdrop)."""
    subprocess.run(
        ["qlmanage", "-t", "-s", str(size), "-o", str(workdir), str(svg)],
        check=True,
        capture_output=True,
    )
    png = workdir / f"{svg.name}.png"
    if not png.exists():
        raise RuntimeError(f"qlmanage did not produce {png}")
    return Image.open(png).convert("RGBA")


def tile_coverage(x: float, y: float) -> float:
    """Antialiased coverage [0,1] of the logo's rounded-rect tile at a pixel."""
    px = x - (LEFT + TILE / 2)
    py = y - (LEFT + TILE / 2)
    qx = abs(px) - (TILE / 2 - RADIUS)
    qy = abs(py) - (TILE / 2 - RADIUS)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    sd = outside + inside - RADIUS
    return min(max(0.5 - sd, 0.0), 1.0)


def build_app_master(workdir: Path) -> Image.Image:
    """Logo on a transparent background with a clean antialiased tile edge."""
    src = rasterize(HERE / "logo.svg", MASTER, workdir)
    out = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    sp = src.load()
    op = out.load()
    for y in range(MASTER):
        for x in range(MASTER):
            a = tile_coverage(x + 0.5, y + 0.5)
            if a <= 0.003:
                op[x, y] = (0, 0, 0, 0)
            elif a >= 0.997:
                r, g, b, _ = sp[x, y]
                op[x, y] = (r, g, b, 255)
            else:
                op[x, y] = (TILE_RGB[0], TILE_RGB[1], TILE_RGB[2], round(a * 255))
    return out


def build_tray(size: int, workdir: Path) -> Image.Image:
    """Black template icon: alpha recovered from the white backdrop."""
    src = rasterize(HERE / "tray.svg", size, workdir)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sp = src.load()
    op = out.load()
    for y in range(size):
        for x in range(size):
            r, g, b, _ = sp[x, y]
            # black artwork over white -> a = 1 - (r+g+b)/3/255
            a = 255 - round((r + g + b) / 3)
            op[x, y] = (0, 0, 0, max(0, min(255, a)))
    return out


def save_iconset(master: Image.Image, workdir: Path) -> None:
    iconset = workdir / "AppIcon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
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
        ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")],
        check=True,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        master = build_app_master(workdir)
        master.save(OUT / "icon.png")
        master.resize((32, 32), Image.LANCZOS).save(OUT / "32x32.png")
        master.resize((64, 64), Image.LANCZOS).save(OUT / "64x64.png")
        master.resize((128, 128), Image.LANCZOS).save(OUT / "128x128.png")
        master.resize((256, 256), Image.LANCZOS).save(OUT / "128x128@2x.png")
        master.resize((512, 512), Image.LANCZOS).save(OUT / "512x512.png")
        save_iconset(master, workdir)
        build_tray(22, workdir).save(OUT / "tray-icon-template.png")
        build_tray(44, workdir).save(OUT / "tray-icon-template@2x.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
