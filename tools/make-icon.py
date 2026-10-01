"""生成桌面图标 build/icon.ico（electron-builder 用）。

设计：玫粉对角渐变圆角方块 + 白色 S —— 颜色取自 Web 端设计 token
accent-400 (#ec4899) → accent-600 (#be185d)，与界面主按钮同一套渐变。

用法： python tools/make-icon.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
RADIUS = int(SIZE * 0.22)
ACCENT_400 = (0xEC, 0x48, 0x99)
ACCENT_600 = (0xBE, 0x18, 0x5D)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ANDROID_RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
ANDROID_DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def diagonal_gradient(size: int, start: tuple, end: tuple) -> Image.Image:
    axis = np.linspace(0.0, 1.0, size)
    t = (axis[:, None] + axis[None, :]) / 2
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    for channel in range(3):
        arr[:, :, channel] = (start[channel] + (end[channel] - start[channel]) * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def build_icon() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(diagonal_gradient(SIZE, ACCENT_400, ACCENT_600), (0, 0), mask)

    font = None
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            font = ImageFont.truetype(path, int(SIZE * 0.6))
            break
    if font is None:
        raise SystemExit("找不到可用的粗体字体，无法绘制字形")

    draw = ImageDraw.Draw(icon)
    left, top, right, bottom = draw.textbbox((0, 0), "S", font=font)
    draw.text(
        ((SIZE - (right - left)) / 2 - left, (SIZE - (bottom - top)) / 2 - top),
        "S",
        font=font,
        fill=(255, 255, 255, 255),
    )
    return icon


def write_android_icons(icon: Image.Image) -> int:
    """生成 Android 启动图标（方形 + 圆形两套，按密度切图）。"""
    if not ANDROID_RES.parent.exists():
        return 0
    written = 0
    for density, size in ANDROID_DENSITIES.items():
        out_dir = ANDROID_RES / f"mipmap-{density}"
        out_dir.mkdir(parents=True, exist_ok=True)

        square = icon.resize((size, size), Image.LANCZOS)
        square.save(out_dir / "ic_launcher.png")
        written += 1

        circle = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        circle.paste(square, (0, 0), mask)
        circle.save(out_dir / "ic_launcher_round.png")
        written += 1
    return written


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "build"
    out_dir.mkdir(exist_ok=True)
    icon = build_icon()
    icon.save(out_dir / "icon.png")
    icon.save(out_dir / "icon.ico", sizes=ICO_SIZES)
    print(f"wrote {out_dir / 'icon.ico'} and icon.png")

    android_count = write_android_icons(icon)
    if android_count:
        print(f"wrote {android_count} Android launcher icons under {ANDROID_RES}")


if __name__ == "__main__":
    main()
