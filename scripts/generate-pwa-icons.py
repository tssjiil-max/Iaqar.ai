#!/usr/bin/env python3
"""Regenerate PWA / splash icons from a source PNG.

Usage:
  python3 scripts/generate-pwa-icons.py path/to/your-logo.png

Expects a square logo (512×512 recommended). Replaces near-black backgrounds
with the site mint color (#F1F5F2), writes:
  public/icons/icon-512.png
  public/icons/icon-192.png
  public/icons/icon-512-maskable.png
  public/icons/icon-192-maskable.png

Optional: also refresh the header placeholder when passed --header:
  python3 scripts/generate-pwa-icons.py logo.png --header
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Install Pillow first: pip install pillow") from exc

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
BRAND_BG = (241, 245, 242, 255)


def replace_black_bg(img: Image.Image) -> Image.Image:
    out = img.convert("RGBA")
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and r < 40 and g < 40 and b < 40:
                px[x, y] = BRAND_BG
            elif r < 25 and g < 25 and b < 25:
                px[x, y] = BRAND_BG
    return out


def make_maskable(src: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BRAND_BG)
    logo_size = int(size * 0.72)
    logo = src.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    offset = (size - logo_size) // 2
    canvas.paste(logo, (offset, offset), logo)
    return canvas


def write_icons(source: Path, header: bool = False) -> None:
    base = replace_black_bg(Image.open(source))
    square = base.resize((512, 512), Image.Resampling.LANCZOS)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    square.save(ICON_DIR / "icon-512.png", optimize=True)
    square.resize((192, 192), Image.Resampling.LANCZOS).save(ICON_DIR / "icon-192.png", optimize=True)
    make_maskable(square, 512).save(ICON_DIR / "icon-512-maskable.png", optimize=True)
    make_maskable(square, 192).save(ICON_DIR / "icon-192-maskable.png", optimize=True)
    if header:
        header_img = replace_black_bg(Image.open(source))
        header_img.save(ICON_DIR / "default-office.png", optimize=True)
    print(f"Wrote PWA icons under {ICON_DIR}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate IAQAR PWA splash icons")
    parser.add_argument("source", type=Path, help="Square PNG logo (512×512 recommended)")
    parser.add_argument("--header", action="store_true", help="Also update public/icons/default-office.png")
    args = parser.parse_args(argv)
    if not args.source.is_file():
        parser.error(f"Source not found: {args.source}")
    write_icons(args.source, header=args.header)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
