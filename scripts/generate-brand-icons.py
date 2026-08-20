#!/usr/bin/env python3
"""Generate IAQAR gold/green PWA icons and header logo."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"

GREEN_DARK = (0, 63, 52, 255)       # #003F34 splash / maskable bg
GREEN = (0, 92, 75, 255)            # #005C4B
GREEN_DEEP = (8, 105, 93, 255)      # #08695D
GOLD = (197, 160, 89, 255)          # #C5A059
GOLD_LIGHT = (229, 198, 130, 255)
MINT = (241, 245, 242, 255)         # #F1F5F2 light icon bg
CREAM = (248, 246, 240, 255)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_brand_logo(size: int, background: tuple[int, int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), background)
    draw = ImageDraw.Draw(img)
    cx = size * 0.5
    head_cy = size * 0.36
    head_r = size * 0.23
    stroke = max(3, int(size * 0.028))

    # Pin point
    tip_y = size * 0.82
    tip_x = cx
    left_x = cx - head_r * 0.72
    right_x = cx + head_r * 0.72
    join_y = head_cy + head_r * 0.55

    pin_points = [
        (left_x, join_y),
        (tip_x, tip_y),
        (right_x, join_y),
    ]

    # Gold pin outline with subtle highlight
    draw.line(
        [(left_x, join_y), (tip_x, tip_y), (right_x, join_y)],
        fill=GOLD,
        width=stroke,
        joint="curve",
    )
    draw.ellipse(
        [
            cx - head_r - stroke,
            head_cy - head_r - stroke,
            cx + head_r + stroke,
            head_cy + head_r + stroke,
        ],
        outline=GOLD,
        width=stroke,
    )

    # Inner cream disc + gold ring
    inner_r = head_r * 0.58
    draw.ellipse(
        [cx - inner_r, head_cy - inner_r, cx + inner_r, head_cy + inner_r],
        fill=CREAM,
    )
    ring_r = head_r * 0.52
    draw.ellipse(
        [cx - ring_r, head_cy - ring_r, cx + ring_r, head_cy + ring_r],
        outline=GOLD,
        width=max(2, int(size * 0.018)),
    )

    # House silhouette
    house_w = inner_r * 1.05
    house_h = inner_r * 0.82
    base_y = head_cy + inner_r * 0.18
    roof_top = base_y - house_h
    left = cx - house_w * 0.5
    right = cx + house_w * 0.5
    draw.polygon(
        [
            (cx, roof_top),
            (left, base_y - house_h * 0.42),
            (right, base_y - house_h * 0.42),
        ],
        fill=GREEN,
    )
    body_h = house_h * 0.58
    draw.rectangle([left, base_y - body_h, right, base_y], fill=GREEN)
    door_w = house_w * 0.22
    draw.rectangle(
        [cx - door_w * 0.5, base_y - body_h * 0.42, cx + door_w * 0.5, base_y],
        fill=GREEN_DEEP,
    )

    # Ground shadow oval
    shadow_w = head_r * 1.05
    shadow_h = head_r * 0.18
    shadow_y = tip_y + size * 0.025
    draw.ellipse(
        [cx - shadow_w, shadow_y - shadow_h, cx + shadow_w, shadow_y + shadow_h],
        outline=GOLD,
        width=max(2, int(size * 0.016)),
    )

    return img


def make_maskable(logo: Image.Image, size: int, background: tuple[int, int, int, int]) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    logo_size = int(size * 0.72)
    scaled = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    offset = (size - logo_size) // 2
    canvas.paste(scaled, (offset, offset), scaled)
    return canvas


def write_all() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    light_512 = draw_brand_logo(512, MINT)
    dark_512 = draw_brand_logo(512, GREEN_DARK)

    light_512.save(ICON_DIR / "icon-512.png", optimize=True)
    light_512.resize((192, 192), Image.Resampling.LANCZOS).save(ICON_DIR / "icon-192.png", optimize=True)

    make_maskable(dark_512, 512, GREEN_DARK).save(ICON_DIR / "icon-512-maskable.png", optimize=True)
    make_maskable(dark_512, 192, GREEN_DARK).save(ICON_DIR / "icon-192-maskable.png", optimize=True)

    header = draw_brand_logo(480, MINT)
    header = header.resize((325, 480), Image.Resampling.LANCZOS)
    header.save(ICON_DIR / "default-office.png", optimize=True)

    # Favicon sizes for desktop browser tabs
    light_512.resize((32, 32), Image.Resampling.LANCZOS).save(ICON_DIR / "favicon-32.png", optimize=True)
    light_512.resize((16, 16), Image.Resampling.LANCZOS).save(ICON_DIR / "favicon-16.png", optimize=True)

    print(f"Wrote gold/green brand icons to {ICON_DIR}")


if __name__ == "__main__":
    write_all()
