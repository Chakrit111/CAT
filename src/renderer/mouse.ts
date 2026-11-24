import type { MouseApi } from '../shared/types';
import { drawMouse, MOUSE_UNITS } from './draw-mouse';

declare global {
  interface Window {
    mouse: MouseApi;
  }
}

function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#mouse');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) throw new Error('Canvas 2D context unavailable');

  let flip = false;
  let moving = true;
  window.mouse.onState((msg) => {
    flip = msg.flip;
    moving = msg.moving;
  });

  const draw = (now: number): void => {
    const px = Math.round(canvas.clientWidth * window.devicePixelRatio);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    const scale = px / MOUSE_UNITS;
    ctx.setTransform(flip ? -scale : scale, 0, 0, scale, flip ? px : 0, 0);
    ctx.clearRect(0, 0, MOUSE_UNITS, MOUSE_UNITS);
    drawMouse(ctx, now, moving);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

start();
