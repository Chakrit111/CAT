"""One-off: cut the hamster out of the climb panels (green background, hamster drawn with its
wheel), shrink it to the size of the other poses and place it for the pack's own wheel picture.
usage: python climb_frames.py source wheel.png out_dir [--k 0.79] [--ax 217] [--ay 331]
"""
import argparse
import os
from collections import deque

from PIL import Image, ImageChops, ImageFilter

PANELS = [(560, 0, 985, 384), (1000, 0, 1376, 384), (0, 384, 344, 768), (344, 384, 688, 768), (688, 384, 1032, 768), (1032, 384, 1376, 768)]


def key_green(im):
    im = im.convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            spill = g - max(r, b)
            a = 0 if spill > 90 else 255 if spill < 25 else round(255 * (90 - spill) / 65)
            px[x, y] = (r, min(g, max(r, b) + 10), b, a)
    return im


def blue_box(im):
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a > 128 and b > r + 40:
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def is_hamster(p):
    r, g, b, a = p
    if a < 128:
        return False
    if (r > 150 and g < 110) or (r > 80 and g < 0.5 * r and b < 0.5 * r) or (r > 120 and r > 1.5 * g and abs(g - b) < 35):
        return False  # the red stand
    if r >= b + 10:
        return True  # fur, feet, brown outline
    if max(r, g, b) < 90 and r >= b - 8:
        return True  # neutral dark outline, eye
    return min(r, g, b) > 200 and r >= b - 6  # white belly


def hamster_mask(im, thin_guard):
    W, H = im.size
    px = im.load()
    m = [[is_hamster(px[x, y]) for x in range(W)] for y in range(H)]
    raw = Image.new('L', (W, H), 0)
    rp = raw.load()
    for y in range(H):
        for x in range(W):
            if m[y][x]:
                rp[x, y] = 255
    # thin_guard (the hamster touches the stand): thin lines such as the stand's dark outline must
    # not join the hamster, so look for the blob on an eroded copy, then grow it back and keep only
    # what the raw test accepted. It also shortens a thin tail, so it is off inside the wheel.
    ep = (raw.filter(ImageFilter.MinFilter(5)) if thin_guard else raw).load()
    e = [[ep[x, y] > 0 for x in range(W)] for y in range(H)]
    seen = [[False] * W for _ in range(H)]
    best = []
    for y in range(H):
        for x in range(W):
            if not e[y][x] or seen[y][x]:
                continue
            blob, q = [], deque([(x, y)])
            seen[y][x] = True
            while q:
                cx, cy = q.popleft()
                blob.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < H and e[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(blob) > len(best):
                best = blob
    core = Image.new('L', (W, H), 0)
    cp = core.load()
    for x, y in best:
        cp[x, y] = 255
    gp = ImageChops.multiply(core.filter(ImageFilter.MaxFilter(9)) if thin_guard else core, raw).load()
    best = [(x, y) for y in range(H) for x in range(W) if gp[x, y] > 0]
    inb = [[False] * W for _ in range(H)]
    for x, y in best:
        inb[y][x] = True
    # The hamster's own outline is near-black; where it lies over the dark tread it fails the colour
    # test. Dark pixels within 2 px of the blob are outline.
    blob_im = Image.new('L', (W, H), 0)
    bp = blob_im.load()
    for x, y in best:
        bp[x, y] = 255
    near = blob_im.filter(ImageFilter.MaxFilter(5)).load()
    for y in range(H):
        for x in range(W):
            if near[x, y] and not inb[y][x]:
                r, g, b, a = px[x, y]
                if a > 128 and max(r, g, b) < 110 and not (r > 80 and g < 0.5 * r and b < 0.5 * r):
                    inb[y][x] = True
    # Fill holes: whatever the outside cannot reach belongs to the hamster.
    out = [[False] * W for _ in range(H)]
    q = deque()
    for x in range(W):
        q.extend([(x, 0), (x, H - 1)])
    for y in range(H):
        q.extend([(0, y), (W - 1, y)])
    while q:
        x, y = q.popleft()
        if not (0 <= x < W and 0 <= y < H) or out[y][x] or inb[y][x]:
            continue
        out[y][x] = True
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    mask = Image.new('L', (W, H), 0)
    mp = mask.load()
    for y in range(H):
        for x in range(W):
            if not out[y][x]:
                mp[x, y] = 255
    return mask.filter(ImageFilter.GaussianBlur(0.7))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('source')
    ap.add_argument('wheel')
    ap.add_argument('out')
    ap.add_argument('--k', type=float, default=0.79)
    ap.add_argument('--ax', type=float, default=217)
    ap.add_argument('--ay', type=float, default=331)
    ap.add_argument('--inside-from', type=int, default=2, help='first frame with the hamster inside the wheel')
    ap.add_argument('--opening', default='135.75,136.75,98.75,113.25', help='front opening cx,cy,a,b: frames inside the wheel are fitted into it')
    ap.add_argument('--margin', type=float, default=3, help='keep this far inside the opening, px')
    ap.add_argument('--fit-tol', type=int, default=6, help='sampled pixels (tail tip) allowed outside the opening')
    ap.add_argument('--shift', default='', help='extra dx,dy per outside frame, e.g. "30,0;10,-5"')
    args = ap.parse_args()
    src = Image.open(args.source)
    wheel = Image.open(args.wheel).convert('RGBA')
    wx0, wy0, wx1, wy1 = blue_box(wheel)
    os.makedirs(args.out, exist_ok=True)
    shifts = [tuple(int(v) for v in t.split(',')) for t in args.shift.split(';') if t]
    for i, box in enumerate(PANELS):
        panel = key_green(src.crop(box))
        bx0, by0, bx1, by1 = blue_box(panel)
        s = ((wx1 - wx0) / (bx1 - bx0) + (wy1 - wy0) / (by1 - by0)) / 2
        # panel px -> canvas px at the wheel's scale, then shrunk by k around (ax, ay)
        ox = (wx0 + wx1) / 2 - s * (bx0 + bx1) / 2
        oy = (wy0 + wy1) / 2 - s * (by0 + by1) / 2
        mask = hamster_mask(panel, i < args.inside_from)
        r, g, b, a = panel.split()
        ham = Image.merge('RGBA', (r, g, b, ImageChops.multiply(a, mask)))
        scale = s * args.k
        size = (round(panel.width * scale), round(panel.height * scale))
        ham = ham.resize(size, Image.LANCZOS)
        x = round(args.ax + args.k * (ox - args.ax))
        y = round(args.ay + args.k * (oy - args.ay))
        if i >= args.inside_from:
            # Inside the wheel: as low as the whole hamster still fits in the opening, feet on its curve.
            ecx, ecy, ea, eb = [float(v) for v in args.opening.split(',')]
            ea, eb = ea - args.margin, eb - args.margin
            al = ham.getchannel('A').load()
            pts = [(u, v) for v in range(0, ham.height, 2) for u in range(0, ham.width, 2) if al[u, v] > 128]
            l, r_ = min(u for u, _ in pts), max(u for u, _ in pts)
            x0 = round(ecx - (l + r_) / 2)

            def fits(px_, py_):
                out = 0
                for u, v in pts:
                    if ((u + px_ - ecx) / ea) ** 2 + ((v + py_ - ecy) / eb) ** 2 > 1:
                        out += 1
                        if out > args.fit_tol:
                            return False
                return True

            x, y = next(((x0 + dx, py_) for py_ in range(wheel.height, -ham.height, -2)
                         for dx in sorted(range(-40, 41, 2), key=abs) if fits(x0 + dx, py_)), (x, y))
        elif shifts[i:i + 1]:
            x += shifts[i][0]
            y += shifts[i][1]
        canvas = Image.new('RGBA', wheel.size)
        canvas.alpha_composite(ham, (max(x, 0), max(y, 0)), (max(-x, 0), max(-y, 0)))
        canvas.save(os.path.join(args.out, f'{i}.png'))
        print(i, 'scale %.3f' % scale, 'at', x, y, 'bbox', canvas.getbbox())


if __name__ == '__main__':
    main()
