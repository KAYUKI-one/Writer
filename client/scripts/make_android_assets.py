"""生成 Android 图标与启动图（不依赖 @capacitor/assets，避免 sharp 下载）。

    uv run --with pillow python scripts/make_android_assets.py

在 ``npx cap add android`` 之后运行。会覆盖模板自带的 Capacitor 图标。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from make_icons import CREAM, FONT_PATH, INK, PAPER

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SCALE = 4

DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}


def _glyph_canvas(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(FONT_PATH), int(size * SCALE * 0.52))
    glyph = "写"
    box = draw.textbbox((0, 0), glyph, font=font)
    x = (size * SCALE - (box[2] - box[0])) / 2 - box[0]
    y = (size * SCALE - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), glyph, font=font, fill=CREAM)
    return canvas


def foreground_icon(size: int) -> Image.Image:
    return _glyph_canvas(size).resize((size, size), Image.LANCZOS)


def square_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (0, 0, size * SCALE - 1, size * SCALE - 1),
        radius=int(size * SCALE * 0.22),
        fill=INK,
    )
    return Image.alpha_composite(canvas, _glyph_canvas(size)).resize(
        (size, size), Image.LANCZOS
    )


def round_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((0, 0, size * SCALE - 1, size * SCALE - 1), fill=INK)
    return Image.alpha_composite(canvas, _glyph_canvas(size)).resize(
        (size, size), Image.LANCZOS
    )


def make_splash(path: Path) -> None:
    with Image.open(path) as current:
        width, height = current.size
    canvas = Image.new("RGB", (width, height), PAPER[:3])
    mark_size = max(96, int(min(width, height) * 0.3))
    mark = square_icon(mark_size)
    canvas.paste(mark, ((width - mark_size) // 2, (height - mark_size) // 2), mark)
    canvas.save(path, optimize=True)


def main() -> None:
    if not RES.exists():
        raise SystemExit(f"找不到 Android 资源目录：{RES}\n先运行 npx cap add android")

    for density, factor in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        square_icon(round(48 * factor)).save(folder / "ic_launcher.png", optimize=True)
        round_icon(round(48 * factor)).save(folder / "ic_launcher_round.png", optimize=True)
        # 自适应图标前景层是 108dp，字形落在中间 66dp 安全区里
        foreground_icon(round(108 * factor)).save(
            folder / "ic_launcher_foreground.png", optimize=True
        )

    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        '    <color name="ic_launcher_background">#24211C</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )

    for splash in RES.glob("drawable*/splash.png"):
        make_splash(splash)

    print("Android icons and splash screens updated")


if __name__ == "__main__":
    main()
