"""One image with every state and frame of a sprite set, one row per state: for checking a set
at a glance and for showing a client.

usage: python -I contact_sheet.py SPRITES_DIR OUT.png [--thumb 128]

States are listed in the app's order; a state without a folder shows the idle frames it falls
back to. Folders the app does not know are listed last, marked "not used by the app".
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STATES = ["idle", "walk", "run", "sit", "stand", "sleep", "roll", "chase", "jump", "drag", "fall"]


def font(size, bold=False):
    try:
        return ImageFont.truetype(f"C:/Windows/Fonts/{'segoeuib' if bold else 'segoeui'}.ttf", size)
    except OSError:
        return ImageFont.load_default()


def frames(folder):
    return sorted(folder.glob("*.png"), key=lambda p: (len(p.stem), p.stem))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sprites")
    ap.add_argument("out")
    ap.add_argument("--thumb", type=int, default=128)
    a = ap.parse_args()
    root, thumb, gap, label_w, pad = Path(a.sprites), a.thumb, 8, 150, 16

    rows = []
    for state in STATES:
        folder = root / state
        if folder.is_dir() and frames(folder):
            rows.append((state, "", frames(folder)))
        else:
            rows.append((state, "no folder: uses idle", frames(root / "idle")))
    for extra in sorted(p for p in root.iterdir() if p.is_dir() and p.name not in STATES):
        rows.append((extra.name, "not used by the app", frames(extra)))

    cols = max(1, max(len(f) for _, _, f in rows))
    row_h = 22 + thumb + gap * 2
    sheet = Image.new("RGB", (pad * 2 + label_w + cols * (thumb + gap), pad * 2 + 44 + row_h * len(rows)), (250, 250, 250))
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, pad), f"Sprites: {root}", fill=(30, 30, 30), font=font(20, True))
    y = pad + 44
    for i, (state, note, files) in enumerate(rows):
        if i % 2:
            draw.rectangle([0, y - gap, sheet.width, y + row_h - gap], fill=(240, 240, 240))
        draw.text((pad, y + 22 + thumb // 2 - 24), state, fill=(20, 20, 20), font=font(22, True))
        draw.text((pad, y + 22 + thumb // 2 + 4), f"{len(files)} frames", fill=(110, 110, 110), font=font(15))
        if note:
            draw.text((pad + label_w, y), note, fill=(160, 60, 40), font=font(15))
        x = pad + label_w
        for n, file in enumerate(files):
            img = Image.open(file).convert("RGBA").resize((thumb, thumb), Image.LANCZOS)
            tile = Image.new("RGBA", (thumb, thumb), (255, 255, 255, 255))
            tile.alpha_composite(img)
            sheet.paste(tile.convert("RGB"), (x, y + 22))
            draw.rectangle([x, y + 22, x + thumb - 1, y + 22 + thumb - 1], outline=(215, 215, 215))
            draw.text((x + 4, y + 24), str(n), fill=(150, 150, 150), font=font(12))
            x += thumb + gap
        y += row_h
    sheet.save(a.out)
    print(f"{a.out}  {sheet.width}x{sheet.height}, {len(rows)} states")


main()
