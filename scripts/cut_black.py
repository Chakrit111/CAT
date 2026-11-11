"""Cut glowing or glassy artwork out of a black background: brightness becomes opacity, so glass and
glow stay see-through (light added over whatever is behind, as on the black it was drawn on).

usage: python -I cut_black.py IN OUT.png --box L,T,R,B [--gain 1.3] [--floor 10]
  --box    part of the picture to keep (e.g. one figure of a sheet, without its caption)
  --gain   multiply opacity (more solid glass); --floor: brightness (0-255) treated as black
"""
import argparse

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--box", required=True)
ap.add_argument("--gain", type=float, default=1.3)
ap.add_argument("--floor", type=int, default=10)
a = ap.parse_args()

im = Image.open(a.src).convert("RGB").crop(tuple(int(v) for v in a.box.split(",")))
out = Image.new("RGBA", im.size)
src, dst = im.load(), out.load()
for y in range(im.height):
    for x in range(im.width):
        r, g, b = src[x, y]
        m = max(r, g, b)
        if m <= a.floor:
            continue
        alpha = min(1.0, (m - a.floor) / (255 - a.floor) * a.gain)
        # The colour of the light before it was dimmed onto black: brightest channel at full.
        dst[x, y] = (round(r * 255 / m), round(g * 255 / m), round(b * 255 / m), round(alpha * 255))
box = out.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
out.crop(box).save(a.out)
print(a.out, out.crop(box).size)
