"""Place run frames inside a pack's wheel that is drawn at an angle.

Each frame is moved (never scaled) as low as the whole pet still fits inside the wheel's opening,
so its feet rest on the curve of the rim and nothing is hidden behind it. The frames come out on
the same canvas as the wheel picture; use them with tuning.wheel scale 1, floor 1, centerX 0.5.

usage: python fit_in_wheel.py <frames dir> <out dir> --opening cx,cy,a,b
           [--margin 3] [--tol 6] [--sway 16] [--preview sheet.png --wheel wheel.png]
"""
import argparse
import glob
import os

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    ap.add_argument('--opening', required=True, help='ellipse of the opening: cx,cy,a,b in picture pixels')
    ap.add_argument('--margin', type=float, default=3, help='stay this far inside the opening, px')
    ap.add_argument('--tol', type=int, default=6, help='sampled pixels (a tail tip) allowed outside')
    ap.add_argument('--sway', type=int, default=16, help='how far a frame may move sideways from centre, px')
    ap.add_argument('--preview', help='write a sheet of the frames over --wheel')
    ap.add_argument('--wheel')
    args = ap.parse_args()
    cx, cy, a, b = [float(v) for v in args.opening.split(',')]
    a, b = a - args.margin, b - args.margin
    files = sorted(glob.glob(os.path.join(args.frames, '*.png')), key=lambda p: int(os.path.splitext(os.path.basename(p))[0]))
    os.makedirs(args.out, exist_ok=True)
    placed = []
    for f in files:
        im = Image.open(f).convert('RGBA')
        box = im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
        pet = im.crop(box)
        al = pet.getchannel('A').load()
        pts = [(u, v) for v in range(0, pet.height, 2) for u in range(0, pet.width, 2) if al[u, v] > 128]

        def fits(x, y):
            out = 0
            for u, v in pts:
                if ((u + x - cx) / a) ** 2 + ((v + y - cy) / b) ** 2 > 1:
                    out += 1
                    if out > args.tol:
                        return False
            return True

        x0 = round(cx - pet.width / 2)
        spot = next(((x0 + dx, y) for y in range(im.height, -pet.height, -1)
                     for dx in sorted(range(-args.sway, args.sway + 1), key=abs) if fits(x0 + dx, y)), None)
        if spot is None:
            raise SystemExit(f'{f}: does not fit in the opening; make the pet smaller or raise --tol')
        canvas = Image.new('RGBA', im.size)
        canvas.alpha_composite(pet, spot)
        name = os.path.basename(f)
        canvas.save(os.path.join(args.out, name))
        placed.append(canvas)
        print(name, 'at', spot, 'feet y', spot[1] + pet.height)
    if args.preview and args.wheel:
        wheel = Image.open(args.wheel).convert('RGBA')
        sheet = Image.new('RGB', (len(placed) * wheel.width, wheel.height), (40, 44, 52))
        for i, p in enumerate(placed):
            cell = Image.new('RGBA', wheel.size, (40, 44, 52, 255))
            cell.alpha_composite(wheel)
            cell.alpha_composite(p)
            sheet.paste(cell.convert('RGB'), (i * wheel.width, 0))
        sheet.save(args.preview)


if __name__ == '__main__':
    main()
