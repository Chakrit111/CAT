"""Builds a multi-size .ico from one sprite frame.

Small sizes (tray) use a crop of the head, large sizes (shortcut) the whole cat.
usage: make_icon.py <frame.png> <out.ico> <preview.png> <head_left,top,right,bottom>
"""
import sys

from PIL import Image

SMALL = [16, 20, 24, 32, 40]
LARGE = [48, 64, 128, 256]


def square(im: Image.Image, margin: float = 0.04) -> Image.Image:
    """Trim to the opaque pixels, then centre on a transparent square."""
    box = im.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    im = im.crop(box)
    side = round(max(im.size) * (1 + 2 * margin))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return out


def main() -> None:
    src, out_ico, out_preview, head_box = sys.argv[1:5]
    frame = Image.open(src).convert("RGBA")
    whole = square(frame)
    head = square(frame.crop(tuple(int(v) for v in head_box.split(","))), margin=0)

    images = {s: head.resize((s, s), Image.LANCZOS) for s in SMALL}
    images.update({s: whole.resize((s, s), Image.LANCZOS) for s in LARGE})

    sizes = sorted(images)
    images[256].save(
        out_ico,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=[images[s] for s in sizes if s != 256],
    )

    # Preview: every size blown up to 128 px on light and dark, to judge legibility.
    cell = 128
    sheet = Image.new("RGBA", (cell * len(sizes), cell * 2), (255, 255, 255, 255))
    for i, s in enumerate(sizes):
        big = images[s].resize((cell, cell), Image.NEAREST)
        for row, bg in enumerate([(243, 243, 243, 255), (32, 32, 32, 255)]):
            tile = Image.new("RGBA", (cell, cell), bg)
            tile.alpha_composite(big)
            sheet.paste(tile, (i * cell, row * cell))
    sheet.save(out_preview)

    with Image.open(out_ico) as ico:
        print("ico sizes:", sorted(ico.info.get("sizes", [])))


main()
