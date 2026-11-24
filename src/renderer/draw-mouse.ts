/** The mouse is drawn in a square this many units wide, facing right, feet on the bottom edge. */
export const MOUSE_UNITS = 56;
const FUR = '#8e9099';
const FUR_DARK = '#74767f';
const PINK = '#e7a3ad';

/**
 * Draws one mouse into the MOUSE_UNITS square at the origin; the caller's transform places, sizes
 * and mirrors it.
 * @param now    animation clock, ms
 * @param moving false while it stands still, so its legs stop
 */
export function drawMouse(ctx: CanvasRenderingContext2D, now: number, moving: boolean): void {
  const blob = (x: number, y: number, rx: number, ry: number, fill: string): void => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const stride = moving ? Math.sin(now / 45) : 0;
  const bob = Math.abs(stride) * 1.2;

  // Tail
  ctx.beginPath();
  ctx.moveTo(14, 46 - bob);
  ctx.quadraticCurveTo(4, 46, 3, 36 + stride * 3);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = PINK;
  ctx.stroke();

  // Feet
  blob(20 - stride * 3, 53, 3.5, 2.2, FUR_DARK);
  blob(38 + stride * 3, 53, 3.5, 2.2, FUR_DARK);

  // Body and head
  blob(27, 44 - bob, 15, 9.5, FUR);
  blob(42, 45 - bob, 9, 7, FUR);

  // Ear, eye, nose
  blob(38, 36 - bob, 5.5, 5.5, FUR_DARK);
  blob(38, 36 - bob, 3.2, 3.2, PINK);
  blob(45, 43 - bob, 1.5, 1.5, '#1d1d22');
  blob(51, 46 - bob, 1.6, 1.6, PINK);
}
