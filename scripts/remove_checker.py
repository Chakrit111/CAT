"""Cut characters out of pictures whose "transparent" background is a painted grey-and-white
checkerboard (what many AI image tools save as JPG), and split a sheet into one PNG per figure.

The background is every greyish, light pixel connected to the picture's border. Line art stops the
fill, so fur inside the outline stays. Anything translucent (glass, glow) over the checkerboard
cannot be recovered this way.

usage: python -I remove_checker.py IN.jpg OUT_DIR [--name base] [--sat 22] [--bright 160]
           [--scale 0.5] [--split auto|none] [--min-area 4000]
writes OUT_DIR/<base>-1.png, -2.png, ... (left to right), each trimmed to the figure.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


def background_mask(rgb, sat, bright):
    """255 where a pixel looks like the checkerboard and touches the border through such pixels."""
    _, s, v = rgb.convert("HSV").split()
    like = ImageChops.multiply(s.point(lambda x: 255 if x < sat else 0), v.point(lambda x: 255 if x > bright else 0))
    w, h = like.size
    seeds = [(x, 0) for x in range(0, w, 3)] + [(x, h - 1) for x in range(0, w, 3)]
    seeds += [(0, y) for y in range(0, h, 3)] + [(w - 1, y) for y in range(0, h, 3)]
    for p in seeds:
        if like.getpixel(p) == 255:
            ImageDraw.floodfill(like, p, 128)
    return like.point(lambda x: 255 if x == 128 else 0)


def keep_largest(alpha, share=0.15):
    """Drops opaque specks (glints, leftovers of glass): keeps the biggest connected region and any
    other region at least `share` of its size."""
    hard = alpha.point(lambda v: 255 if v > 128 else 0)
    w, h = hard.size
    px = hard.load()
    areas = {}
    label = 1
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if px[x, y] == 255 and label < 255:
                ImageDraw.floodfill(hard, (x, y), label)
                areas[label] = hard.histogram()[label]
                label += 1
    if not areas:
        return alpha
    biggest = max(areas.values())
    keep = {k for k, v in areas.items() if v >= biggest * share}
    mask = hard.point(lambda v: 255 if v in keep else 0).filter(ImageFilter.MaxFilter(3))
    return ImageChops.multiply(alpha, mask)


def dark_columns(rgb):
    """Columns that are mostly near-black: divider lines between panels of a sheet."""
    grey = rgb.convert("L")
    w, h = grey.size
    cols = []
    for x in range(w):
        dark = grey.crop((x, int(h * 0.1), x + 1, int(h * 0.9))).point(lambda v: 255 if v < 70 else 0)
        if dark.histogram()[255] > 0.6 * h * 0.8:
            cols.append(x)
    return cols


def segments(alpha, min_width=40):
    """Left-to-right runs of columns that contain opaque pixels."""
    w, h = alpha.size
    filled = [alpha.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    runs, start = [], None
    for x, f in enumerate(filled + [False]):
        if f and start is None:
            start = x
        elif not f and start is not None:
            if x - start >= min_width:
                runs.append((start, x))
            start = None
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--name")
    ap.add_argument("--sat", type=int, default=22, help="max saturation (0-255) of checkerboard pixels")
    ap.add_argument("--bright", type=int, default=160, help="min brightness (0-255) of checkerboard pixels")
    ap.add_argument("--scale", type=float, default=0.5, help="work at this fraction of the size (speed)")
    ap.add_argument("--split", choices=["auto", "none"], default="auto")
    ap.add_argument("--min-area", type=int, default=4000, help="drop figures smaller than this many pixels")
    ap.add_argument("--keep-largest", action="store_true", help="per figure, drop specks around the main shape")
    a = ap.parse_args()

    src = Path(a.src)
    rgb = Image.open(src).convert("RGB")
    if a.scale != 1:
        rgb = rgb.resize((round(rgb.width * a.scale), round(rgb.height * a.scale)), Image.LANCZOS)

    # Panel dividers would join neighbouring figures; paint them as background first.
    dividers = dark_columns(rgb) if a.split == "auto" else []
    if dividers:
        draw = ImageDraw.Draw(rgb)
        for x in dividers:
            draw.line([(x, 0), (x, rgb.height)], fill=(255, 255, 255), width=7)

    bg = background_mask(rgb, a.sat, a.bright).filter(ImageFilter.MaxFilter(3))  # eat the JPEG halo
    alpha = ImageChops.invert(bg).filter(ImageFilter.GaussianBlur(0.7))
    rgba = rgb.copy()
    rgba.putalpha(alpha)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    base = a.name or src.stem
    hard = alpha.point(lambda v: 255 if v > 128 else 0)
    runs = segments(hard) if a.split == "auto" else [(0, rgb.width)]
    n = 0
    for x0, x1 in runs:
        piece = rgba.crop((x0, 0, x1, rgba.height))
        if a.keep_largest:
            piece.putalpha(keep_largest(piece.getchannel("A")))
        box = piece.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
        if not box:
            continue
        piece = piece.crop(box)
        area = piece.getchannel("A").point(lambda v: 255 if v > 128 else 0).histogram()[255]
        if area < a.min_area:
            continue
        n += 1
        piece.save(out / f"{base}-{n}.png")
        print(f"{base}-{n}.png  {piece.size[0]}x{piece.size[1]}  (x {x0}-{x1})")
    print(f"{n} figure(s) from {src.name}{'; dividers at ' + str(len(dividers)) + ' columns' if dividers else ''}")


main()
