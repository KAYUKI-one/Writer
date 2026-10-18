"""生成 Windows / Android 图标与启动图。

    uv run --with pillow python scripts/make_icons.py

输出：
    electron/icon.png         Electron 窗口图标
    build/icon.ico            electron-builder 的 exe 图标（多尺寸）
    resources/icon.png        @capacitor/assets 的 Android 图标源图
    resources/splash.png      Android 启动图源图
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")

INK = (36, 33, 28, 255)
CREAM = (250, 246, 237, 255)
PAPER = (251, 250, 247, 255)
SCALE = 4  # 超采样，圆角和字边缘更干净


def rounded_icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    radius = int(size * SCALE * 0.22)
    draw.rounded_rectangle(
        (0, 0, size * SCALE - 1, size * SCALE - 1), radius=radius, fill=INK
    )

    font_size = int(size * SCALE * 0.58)
    font = ImageFont.truetype(str(FONT_PATH), font_size)
    glyph = "写"
    box = draw.textbbox((0, 0), glyph, font=font)
    x = (size * SCALE - (box[2] - box[0])) / 2 - box[0]
    y = (size * SCALE - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), glyph, font=font, fill=CREAM)

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    electron = ROOT / "electron"
    build = ROOT / "build"
    resources = ROOT / "resources"
    for folder in (electron, build, resources):
        folder.mkdir(parents=True, exist_ok=True)

    icon_1024 = rounded_icon(1024)
    icon_1024.save(resources / "icon.png")

    rounded_icon(512).save(electron / "icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    icons = [rounded_icon(s) for s in sizes]
    icons[-1].save(
        build / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=icons[:-1],
    )

    # 启动图：米白底 + 居中图标
    splash_size = 2732
    splash = Image.new("RGBA", (splash_size, splash_size), PAPER)
    mark = rounded_icon(560)
    splash.alpha_composite(mark, ((splash_size - 560) // 2, (splash_size - 560) // 2))
    splash.convert("RGB").save(resources / "splash.png", quality=92)

    print("icons written to electron/, build/, resources/")


if __name__ == "__main__":
    main()
