"""Turn artwork of one pose into sprite frames that match the rest of the set.

Takes a folder of source images (any size, transparent background), scales every one by the
same factor, places them on a SIZE x SIZE transparent canvas and writes OUT_DIR/0.png, 1.png, ...

Scale (--scale-by):
  marker  a coloured feature the character always has (the donut collar for the shipped cat) is
          made --target px across. Best when the pose changes the body's outline a lot.
  height  the character's opaque bounding box is made --target px tall (averaged over frames).
  fixed   multiply by --target (e.g. 0.3).

Placement (--anchor):
  marker  the marker's centre goes to the canvas centre and its top edge to --marker-top.
          The head stays put while the body moves: dangling, swaying (drag).
  bottom  each frame's feet on the floor line (SIZE - --pad), centred: standing poses.
  center  the middle of the character stays put and the largest frame ends --pad above the
          bottom: poses in the air (fall).

usage:
  python -I fit_frames.py SRC_DIR OUT_DIR [--order a.png,b.png,a.png,c.png] [--scale-by marker]
      [--target 130] [--anchor marker] [--marker 185,75,85] [--marker-top 38] [--pad 8]
      [--size 320] [--replace] [--preview DIR] [--fps 4]

--order lists source file names in play order and may repeat one (a pendulum: centre, right,
centre, left). OUT_DIR must not already hold PNGs unless --replace is given; move the
originals out of the sprite folder (to art/<state>/) before running it.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image

MARGIN = 800  # working border, so frames placed partly off the canvas composite cleanly


def opaque_box(im):
    return im.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()


def marker_box(im, rule, upper_only, trim):
    """Bounding box of marker-coloured pixels, dropping the `trim` share most outlying (stray look-alikes)."""
    rmin, gmax, bmax = rule
    px = im.load()
    xs, ys = [], []
    step = 2 if im.width > 600 else 1
    for y in range(0, im.height // 2 if upper_only else im.height, step):
        for x in range(0, im.width, step):
            r, g, b, a = px[x, y]
            if a > 128 and r > rmin and g < gmax and b < bmax:
                xs.append(x)
                ys.append(y)
    if len(xs) < 20:
        return None
    xs.sort()
    ys.sort()
    cut = int(len(xs) * trim)
    return xs[cut], ys[cut], xs[-cut - 1], ys[-cut - 1]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--order", help="comma-separated source file names in play order (default: sorted)")
    ap.add_argument("--scale-by", choices=["marker", "height", "fixed"], default="marker")
    ap.add_argument("--target", type=float, default=130)
    ap.add_argument("--anchor", choices=["marker", "bottom", "center"], default="marker")
    ap.add_argument("--marker", default="185,75,85", help="min R, max G, max B of the marker colour")
    ap.add_argument("--marker-upper", action="store_true",
                    help="look for the marker in the top half only (when the body has marker-like colours)")
    ap.add_argument("--marker-axis", choices=["long", "width"], default="long",
                    help="measure the marker's longer side (it may be turned) or its width")
    ap.add_argument("--marker-trim", type=float, default=0.02,
                    help="share of outlying marker pixels to ignore on each side (0 = none)")
    ap.add_argument("--marker-top", type=float, default=38)
    ap.add_argument("--pad", type=float, default=8)
    ap.add_argument("--size", type=int, default=320)
    ap.add_argument("--replace", action="store_true", help="delete existing PNGs in OUT_DIR first")
    ap.add_argument("--preview", help="write <state>-frames.png and <state>-loop.gif here")
    ap.add_argument("--fps", type=float, default=4)
    a = ap.parse_args()

    src, out, size = Path(a.src), Path(a.out), a.size
    rule = tuple(int(v) for v in a.marker.split(","))
    names = a.order.split(",") if a.order else sorted(p.name for p in src.iterdir() if p.suffix.lower() == ".png")
    if not names:
        sys.exit(f"no PNG files in {src}")

    out.mkdir(parents=True, exist_ok=True)
    existing = list(out.glob("*.png"))
    if existing and not a.replace:
        sys.exit(f"{out} already has {len(existing)} PNG(s); move them to art/ or pass --replace")

    images = {n: Image.open(src / n).convert("RGBA") for n in dict.fromkeys(names)}
    boxes = {n: opaque_box(im) for n, im in images.items()}
    markers = {}
    if "marker" in (a.scale_by, a.anchor):
        for n, im in images.items():
            m = marker_box(im, rule, a.marker_upper, a.marker_trim)
            if m is None:
                sys.exit(f"marker colour {a.marker} not found in {n}; use --scale-by height / --anchor bottom")
            markers[n] = m

    if a.scale_by == "marker":
        measure = (lambda m: m[2] - m[0]) if a.marker_axis == "width" else (lambda m: max(m[2] - m[0], m[3] - m[1]))
        extent = sum(measure(m) for m in markers.values()) / len(markers)
        scale = a.target / extent
    elif a.scale_by == "height":
        scale = a.target / (sum(b[3] - b[1] for b in boxes.values()) / len(boxes))
    else:
        scale = a.target
    print(f"scale {scale:.3f} ({a.scale_by})")

    half_h = max((b[3] - b[1]) * scale / 2 for b in boxes.values())
    frames = {}
    for n, im in images.items():
        x0, y0, x1, y1 = boxes[n]
        if a.anchor == "marker":
            mx0, my0, mx1, _ = markers[n]
            ox = size / 2 - (mx0 + mx1) / 2 * scale
            oy = a.marker_top - my0 * scale
        elif a.anchor == "bottom":
            ox = size / 2 - (x0 + x1) / 2 * scale
            oy = size - a.pad - y1 * scale
        else:
            ox = size / 2 - (x0 + x1) / 2 * scale
            oy = (size - a.pad - half_h) - (y0 + y1) / 2 * scale
        scaled = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        work = Image.new("RGBA", (size + 2 * MARGIN, size + 2 * MARGIN), (0, 0, 0, 0))
        work.alpha_composite(scaled, (round(ox) + MARGIN, round(oy) + MARGIN))
        canvas = work.crop((MARGIN, MARGIN, MARGIN + size, MARGIN + size))
        bb = opaque_box(canvas)
        clipped = bb is None or bb[0] == 0 or bb[1] == 0 or bb[2] == size or bb[3] == size
        print(f"  {n}: character at {bb}{'  CLIPPED - lower --target or move the anchor' if clipped else ''}")
        frames[n] = canvas

    for p in existing:
        p.unlink()
    for i, n in enumerate(names):
        frames[n].save(out / f"{i}.png", optimize=True)
    print(f"wrote {len(names)} frames to {out}: " + ", ".join(f"{i}={n}" for i, n in enumerate(names)))

    if a.preview:
        prev = Path(a.preview)
        prev.mkdir(parents=True, exist_ok=True)
        state = out.name
        strip = Image.new("RGB", (size * len(names), size * 2))
        gif = []
        for i, n in enumerate(names):
            pair = Image.new("RGB", (size * 2, size))
            for row, bg in enumerate([(236, 236, 236), (40, 40, 40)]):
                tile = Image.new("RGBA", (size, size), bg + (255,))
                tile.alpha_composite(frames[n])
                strip.paste(tile.convert("RGB"), (i * size, row * size))
                pair.paste(tile.convert("RGB"), (row * size, 0))
            gif.append(pair)
        strip.save(prev / f"{state}-frames.png")
        gif[0].save(prev / f"{state}-loop.gif", save_all=True, append_images=gif[1:],
                    duration=round(1000 / a.fps), loop=0)
        print(f"preview: {prev / (state + '-frames.png')}, {prev / (state + '-loop.gif')}")


main()
