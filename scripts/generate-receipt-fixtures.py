#!/usr/bin/env python3
"""Render the receipt photos the Maestro receipt flows share into the app (.maestro/fixtures/).

    pip install pillow && python3 scripts/generate-receipt-fixtures.py

Plain, legible Polish till receipts, one per flow, each with a total no seed transaction has, so a
flow finds its own transaction in Firefly III by amount (.maestro/scripts/ff3.js AMOUNT_IS):

  receipt-r1.jpg  TEST MARKET  31,20 PLN   R1: read by the configured reader, confirmed, attached
  receipt-r2.jpg  ORLEN        17,80 PLN   R2: shared twice, recognised as a duplicate
  receipt-r3.jpg  BIEDRONKA     9,99 PLN   R3: shared with no reader configured

Committed output; re-run only to change a receipt.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / ".maestro" / "fixtures"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

RECEIPTS = {
    "receipt-r1.jpg": {
        "shop": "TEST MARKET",
        "address": "ul. Testowa 1, 00-001 Warszawa",
        "nip": "NIP 525-000-00-01",
        "date": "2026-09-15 12:34",
        "items": [("CHLEB ZYTNI", "1 x 6,50", "6,50"), ("MLEKO 2% 1L", "2 x 4,35", "8,70"), ("SER GOUDA", "1 x 16,00", "16,00")],
        "total": "31,20",
    },
    "receipt-r2.jpg": {
        "shop": "ORLEN",
        "address": "Stacja nr 4321, ul. Paliwowa 7",
        "nip": "NIP 774-000-32-37",
        "date": "2026-09-16 08:05",
        "items": [("KAWA DUZA", "1 x 12,80", "12,80"), ("HOT-DOG", "1 x 5,00", "5,00")],
        "total": "17,80",
    },
    "receipt-r3.jpg": {
        "shop": "BIEDRONKA",
        "address": "ul. Owadzia 3, Kraków",
        "nip": "NIP 779-000-30-40",
        "date": "2026-09-17 18:20",
        "items": [("JABLKA LUZ", "1,210 x 4,95", "5,99"), ("WODA 1,5L", "2 x 2,00", "4,00")],
        "total": "9,99",
    },
}


def render(spec: dict) -> Image.Image:
    width, line = 720, 44
    lines = 12 + len(spec["items"]) * 2
    img = Image.new("RGB", (width, 80 + lines * line), (250, 249, 245))
    draw = ImageDraw.Draw(img)
    regular = ImageFont.truetype(FONT, 28)
    bold = ImageFont.truetype(BOLD, 36)
    y = 40

    def centre(text: str, font: ImageFont.FreeTypeFont) -> None:
        nonlocal y
        w = draw.textlength(text, font=font)
        draw.text(((width - w) / 2, y), text, fill=(20, 20, 20), font=font)
        y += line

    def row(left: str, right: str, font: ImageFont.FreeTypeFont = regular) -> None:
        nonlocal y
        draw.text((40, y), left, fill=(20, 20, 20), font=font)
        w = draw.textlength(right, font=font)
        draw.text((width - 40 - w, y), right, fill=(20, 20, 20), font=font)
        y += line

    centre(spec["shop"], bold)
    centre(spec["address"], regular)
    centre(spec["nip"], regular)
    y += line // 2
    centre("PARAGON FISKALNY", bold)
    row(spec["date"], "")
    y += line // 2
    for name, qty, total in spec["items"]:
        row(name, "")
        row("   " + qty, total + " A")
    y += line // 2
    row("SUMA PLN", spec["total"], bold)
    row("KARTA PLATNICZA", spec["total"])
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, spec in RECEIPTS.items():
        render(spec).save(OUT / name, quality=88)
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
