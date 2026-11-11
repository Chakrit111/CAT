"""Make looping spin frames for a wheel picture drawn in perspective (3/4 view).

The tread band inside the wheel lies between two ellipses: the front edge of the opening
(--front) and the back plate (--back), both cx,cy,a,b in picture pixels. A rung at angle t
runs from front(t) to back(t). The script wipes the picture's own rungs off the band, then
draws evenly spaced rungs that move along the band frame by frame, so the stand, the rim
and the back plate stay still and only the tread turns. Frame N would equal frame 0.

usage: python wheel_rungs.py wheel.png out_dir --front 135.75,136.75,98.75,113.25
           --back 165,135.5,86,104.5 [--spacing 12] [--frames 4] [--darken 0.5] [--width 2.2]
"""
import argparse
import math
import os

from PIL import Image


def ellipse(text):
    v = [float(x) for x in text.split(',')]
    if len(v) != 4:
        raise argparse.ArgumentTypeError('expected cx,cy,a,b')
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wheel')
    ap.add_argument('out')
    ap.add_argument('--front', type=ellipse, required=True)
    ap.add_argument('--back', type=ellipse, required=True)
    ap.add_argument('--spacing', type=float, default=12, help='degrees between rungs')
    ap.add_argument('--frames', type=int, default=4, help='frames per rung spacing')
    ap.add_argument('--darken', type=float, default=0.5, help='rung colour = band colour * (1 - darken)')
    ap.add_argument('--width', type=float, default=2.2, help='rung width, px')
    ap.add_argument('--reverse', action='store_true', help='turn the other way')
    args = ap.parse_args()

    src = Image.open(args.wheel).convert('RGBA')
    W, H = src.size
    px = src.load()
    F, Bk = args.front, args.back

    def inside(E, x, y):
        return ((x - E[0]) / E[2]) ** 2 + ((y - E[1]) / E[3]) ** 2 < 1

    def lerp(s):
        return [F[i] + (Bk[i] - F[i]) * s for i in range(4)]

    def at(t, s):
        cx, cy, a, b = lerp(s)
        return cx + a * math.cos(t), cy + b * math.sin(t)

    def visible(x, y):
        return 0 <= x < W and 0 <= y < H and inside(F, x, y) and not inside(Bk, x, y)

    def param(x, y):
        """(t, s) of a band pixel: the s whose ellipse passes through (x, y), by bisection."""
        lo, hi = 0.0, 1.0
        for _ in range(30):
            mid = (lo + hi) / 2
            cx, cy, a, b = lerp(mid)
            if ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 < 1:
                lo = mid
            else:
                hi = mid
        s = (lo + hi) / 2
        cx, cy, a, b = lerp(s)
        return math.atan2((y - cy) / b, (x - cx) / a), s

    def lum(c):
        return c[0] + c[1] + c[2]

    # The band's pixels, with their (t, s) and the band colour with the old rungs wiped off:
    # the median of samples along the band at the same depth (a rung covers only a few of them).
    band = []
    for y in range(H):
        for x in range(W):
            if px[x, y][3] < 8 or not visible(x + 0.5, y + 0.5):
                continue
            t, s = param(x + 0.5, y + 0.5)
            samples = [px[x, y]]
            for i in range(-4, 5):
                if i == 0:
                    continue
                sx, sy = at(t + math.radians(i * 1.25), s)
                if visible(sx, sy):
                    c = px[int(sx), int(sy)]
                    if c[3] > 128:
                        samples.append(c)
            samples.sort(key=lum)
            best = samples[len(samples) // 2]
            cx, cy, a, b = lerp(s)
            speed = math.hypot(a * math.sin(t), b * math.cos(t))  # px per radian along the band
            # Keep the rungs off the outlines at both edges of the band.
            across = math.dist(at(t, 0), at(t, 1))
            edge = max(0.0, min(1.0, (min(s, 1 - s) * across - 1.0) / 1.5))
            band.append((x, y, t, speed, edge, best))

    step = math.radians(args.spacing)
    os.makedirs(args.out, exist_ok=True)
    for k in range(args.frames):
        shift = step * k / args.frames * (-1 if args.reverse else 1)
        out = src.copy()
        o = out.load()
        for x, y, t, speed, edge, (r, g, b, a) in band:
            off = (t - shift) % step
            d = min(off, step - off) * speed  # px to the nearest rung
            cover = max(0.0, min(1.0, args.width / 2 + 0.5 - d)) * edge
            f = 1 - args.darken * cover
            o[x, y] = (round(r * f), round(g * f), round(b * f), a)
        out.save(os.path.join(args.out, f'{k}.png'))
    print('band px', len(band), 'frames', args.frames)


if __name__ == '__main__':
    main()
