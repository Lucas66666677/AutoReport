from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "brand-source" / "autolabreport-logo-v2.png"
OUTPUT = ROOT / "frontend" / "public" / "brand"
BACKGROUND = "#05070B"

# A square, source-only crop that keeps the complete A/prism subject while
# reducing the surrounding black field at icon sizes. Nothing is redrawn.
MARK_CROP = (250, 250, 1004, 1004)


def resized(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, format="PNG", optimize=True)


def save_webp(image: Image.Image, path: Path, quality: int = 94) -> None:
    image.save(path, format="WEBP", quality=quality, method=6)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "segoeuib.ttf" if bold else "segoeui.ttf"
    path = Path("C:/Windows/Fonts") / filename
    if not path.exists():
        raise FileNotFoundError(f"Required project-system font is missing: {path}")
    return ImageFont.truetype(str(path), size=size)


def generate() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Approved logo source is missing: {SOURCE}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")
    if source.size != (1254, 1254):
        raise ValueError(f"Unexpected approved source dimensions: {source.size}")

    # Keep an exact, high-resolution PNG copy in public assets.
    shutil.copy2(SOURCE, OUTPUT / "autolabreport-logo.png")
    save_webp(source, OUTPUT / "autolabreport-logo.webp")

    mark = source.crop(MARK_CROP)
    for size in (64, 128, 256):
        mark_at_size = resized(mark, size)
        save_png(mark_at_size, OUTPUT / f"autolabreport-mark-{size}.png")
        save_webp(mark_at_size, OUTPUT / f"autolabreport-mark-{size}.webp", quality=96)

    for size in (16, 32, 48):
        save_png(resized(mark, size), OUTPUT / f"favicon-{size}x{size}.png")

    save_png(resized(mark, 180), OUTPUT / "apple-touch-icon.png")
    for size in (192, 512):
        save_png(resized(mark, size), OUTPUT / f"pwa-{size}x{size}.png")

        # Maskable icons keep the unchanged crop inside a conservative safe zone.
        canvas = Image.new("RGB", (size, size), BACKGROUND)
        safe_size = round(size * 0.72)
        safe_mark = resized(mark, safe_size)
        offset = (size - safe_size) // 2
        canvas.paste(safe_mark, (offset, offset))
        save_png(canvas, OUTPUT / f"maskable-{size}x{size}.png")

    # Match the approved artwork's own corner black so its square background
    # blends into the social card without masking or recolouring the source.
    og = Image.new("RGB", (1200, 630), source.getpixel((0, 0)))
    og_logo = resized(source, 470)
    og.paste(og_logo, (42, 80))

    draw = ImageDraw.Draw(og)
    title_font = font(68, bold=True)
    subtitle_font = font(28)
    draw.text((535, 238), "AutoLabReport", font=title_font, fill="#F8FAFC")
    draw.text(
        (539, 337),
        "AI-powered lab report workspace",
        font=subtitle_font,
        fill="#A7B0BE",
    )
    save_png(og, OUTPUT / "autolabreport-og.png")


if __name__ == "__main__":
    generate()
