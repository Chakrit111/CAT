import type { FieldMessage, FieldMouse, OverlayApi } from '../shared/types';
import { drawMouse, MOUSE_UNITS } from './draw-mouse';

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

const LABEL_FONT = "600 11px system-ui, 'Segoe UI', 'Leelawadee UI', Thonburi, sans-serif";
const LABEL_HEIGHT = 16;
const LABEL_PAD = 7;
/** Names of mice that stand close together are pushed this far apart instead of overlapping. */
const LABEL_GAP = 4;

/** The strip along the floor: one mouse per Claude session at work, its name above it. */
function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#field');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) throw new Error('Canvas 2D context unavailable');

  let field: FieldMessage = { size: MOUSE_UNITS, labelHeight: 0, mice: [] };
  window.overlay.onField((msg) => {
    field = msg;
  });

  /**
   * Where each name goes: over its mouse, then slid sideways as far as it takes to stay inside the
   * strip and clear of its neighbours' names.
   */
  const placeLabels = (stripWidth: number): Array<{ mouse: FieldMouse; x: number; width: number }> => {
    ctx.font = LABEL_FONT;
    const labels = field.mice
      .map((mouse) => {
        const width = Math.ceil(ctx.measureText(mouse.label).width) + LABEL_PAD * 2;
        return { mouse, width, x: mouse.x + field.size / 2 - width / 2 };
      })
      .sort((a, b) => a.x - b.x);
    let edge = 1;
    for (const label of labels) {
      label.x = Math.max(label.x, edge);
      edge = label.x + label.width + LABEL_GAP;
    }
    edge = stripWidth - 1;
    for (const label of labels.reverse()) {
      label.x = Math.max(1, Math.min(label.x, edge - label.width));
      edge = label.x - LABEL_GAP;
    }
    return labels;
  };

  /** A pill with the session's name over the mouse's back. */
  const drawLabel = (mouse: FieldMouse, x: number, width: number, now: number): void => {
    ctx.font = LABEL_FONT;
    // The mouse fills the lower half of its square: the pill ends just above its ear.
    const y = field.labelHeight + field.size * 0.5 - LABEL_HEIGHT - 2;

    ctx.beginPath();
    ctx.roundRect(x, y, width, LABEL_HEIGHT, LABEL_HEIGHT / 2);
    if (mouse.waiting) {
      // Waiting for the user: amber, pulsing slowly.
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 280);
      ctx.fillStyle = '#ffb020';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.stroke();

    ctx.fillStyle = '#2b2b33';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(mouse.label, x + width / 2, y + LABEL_HEIGHT / 2 + 0.5);
  };

  const draw = (now: number): void => {
    const dpr = window.devicePixelRatio;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scale = (field.size * dpr) / MOUSE_UNITS;
    for (const mouse of field.mice) {
      const left = mouse.x * dpr;
      ctx.setTransform(mouse.flip ? -scale : scale, 0, 0, scale, mouse.flip ? left + field.size * dpr : left, field.labelHeight * dpr);
      drawMouse(ctx, now, mouse.moving);
    }
    // Names last, so a mouse never walks over another one's name.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const { mouse, x, width } of placeLabels(canvas.clientWidth)) drawLabel(mouse, x, width, now);

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

start();
