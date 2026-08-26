#!/usr/bin/env python3
"""Generate platform icons from the approved IAQAR brand PNG.

Contain-fit only. Never stretch. Never redraw the old gold pin.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"
SOURCE_CANDIDATES = (
    ICON_DIR / "iaqar-brand-source.png",
    Path("/home/ubuntu/.cursor/projects/workspace/assets/ba88eb93-c26f-446e-98fb-64537853add2.png"),
)
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def resolve_source() -> Path:
    for path in SOURCE_CANDIDATES:
        if path.is_file():
            return path
    raise SystemExit("Approved brand source PNG was not found")


def contain_onto(src: Image.Image, size: int, background: tuple[int, int, int, int], scale: float = 1.0) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    image = src.convert("RGBA")
    box = max(1, int(round(size * scale)))
    ratio = min(box / image.width, box / image.height)
    new_w = max(1, int(round(image.width * ratio)))
    new_h = max(1, int(round(image.height * ratio)))
    scaled = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    canvas.paste(scaled, (x, y), scaled)
    return canvas


def make_badge(src: Image.Image, size: int = 96) -> Image.Image:
    rgba = src.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    silhouette = Image.new("RGBA", (width, height), TRANSPARENT)
    out_px = silhouette.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a < 12:
                continue
            distance = (765 - r - g - b) / 3  # 0 = white, 255 = black
            if distance < 8:
                continue
            alpha = min(255, int(distance * 2.4))
            out_px[x, y] = (255, 255, 255, alpha)
    return contain_onto(silhouette, size, TRANSPARENT, scale=0.84)


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, format="PNG", optimize=True)


def write_all() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    source_path = resolve_source()
    repo_source = ICON_DIR / "iaqar-brand-source.png"
    if source_path.resolve() != repo_source.resolve():
        shutil.copy2(source_path, repo_source)

    source = Image.open(repo_source)
    if source.size[0] != source.size[1]:
        raise SystemExit(f"Brand source must stay square, got {source.size}")

    icon_512 = contain_onto(source, 512, WHITE)
    icon_192 = contain_onto(source, 192, WHITE)
    apple_180 = contain_onto(source, 180, WHITE)
    maskable_512 = contain_onto(source, 512, WHITE, scale=0.72)
    maskable_192 = contain_onto(source, 192, WHITE, scale=0.72)
    badge = make_badge(source, 96)
    favicon_32 = contain_onto(source, 32, WHITE)
    favicon_16 = contain_onto(source, 16, WHITE)

    save_png(icon_192.convert("RGB").convert("RGBA"), ICON_DIR / "iaqar-default-icon-192.png")
    save_png(icon_512.convert("RGB").convert("RGBA"), ICON_DIR / "iaqar-default-icon-512.png")
    save_png(maskable_512.convert("RGB").convert("RGBA"), ICON_DIR / "iaqar-default-maskable-512.png")
    save_png(apple_180.convert("RGB").convert("RGBA"), ICON_DIR / "iaqar-apple-touch-icon-180.png")
    save_png(badge, ICON_DIR / "iaqar-badge-icon.png")

    # Compatibility aliases so leftover references are the new art, not the old gold pin.
    save_png(icon_192.convert("RGB").convert("RGBA"), ICON_DIR / "icon-192.png")
    save_png(icon_512.convert("RGB").convert("RGBA"), ICON_DIR / "icon-512.png")
    save_png(maskable_192.convert("RGB").convert("RGBA"), ICON_DIR / "icon-192-maskable.png")
    save_png(maskable_512.convert("RGB").convert("RGBA"), ICON_DIR / "icon-512-maskable.png")
    save_png(icon_192.convert("RGB").convert("RGBA"), ICON_DIR / "default-office.png")
    save_png(favicon_32.convert("RGB").convert("RGBA"), ICON_DIR / "favicon-32.png")
    save_png(favicon_16.convert("RGB").convert("RGBA"), ICON_DIR / "favicon-16.png")

    print(f"Wrote approved brand icons to {ICON_DIR}")


if __name__ == "__main__":
    write_all()
