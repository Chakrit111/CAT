import type { FieldMessage, FieldMouse, MouseActivity, OverlayApi } from '../shared/types';
import { drawMouse, MOUSE_UNITS } from './draw-mouse';

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

const LABEL_FONT = "600 11px system-ui, 'Segoe UI', 'Leelawadee UI', Thonburi, sans-serif";
const LABEL_HEIGHT = 16;
const LABEL_PAD = 7;
/** A name keeps this far from the ends of its mouse's stretch of floor, so two names never touch. */
const LABEL_GAP = 2;

/** The small picture before a name that says what the session is busy with. */
const ACTIVITY_MARK: Record<MouseActivity, string> = {
  none: '',
  reading: '📖',
  editing: '✏️',
  running: '⚙️',
  web: '🌐',
  agent: '🤖',
  tool: '🔧',
};
const MARK_GAP = 3;

interface Label {
  mouse: FieldMouse;
  /** The picture, the name (maybe cut short) and the time, as they are drawn. */
  mark: string;
  text: string;
  x: number;
  width: number;
}

/** The strip along the floor: one mouse per Claude session at work, its name above it. */
function start(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#field');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) throw new Error('Canvas 2D context unavailable');

  let field: FieldMessage = { size: MOUSE_UNITS, labelHeight: 0, mice: [] };
  window.overlay.onField((msg) => {
    field = msg;
  });

  /** The name cut to what fits in `room` px, ending in an ellipsis; '' if not even one letter fits. */
  const fitted = new Map<string, string>();
  const fit = (label: string, room: number): string => {
    const key = `${room}:${label}`;
    const known = fitted.get(key);
    if (known !== undefined) return known;

    let text = label;
    if (ctx.measureText(label).width > room) {
      const letters = [...label.replace(/…$/, '')];
      do letters.pop();
      while (letters.length > 0 && ctx.measureText(`${letters.join('').trimEnd()}…`).width > room);
      text = letters.length > 0 ? `${letters.join('').trimEnd()}…` : '';
    }
    if (fitted.size > 500) fitted.clear();
    fitted.set(key, text);
    return text;
  };

  /**
   * Where each name goes: over its mouse, and inside the mouse's own stretch of floor. The stretches
   * lie side by side, so names never cover each other, however many sessions there are; a name too
   * long for its stretch is cut short.
   */
  const placeLabels = (stripWidth: number): Label[] => {
    ctx.font = LABEL_FONT;
    const labels: Label[] = [];
    for (const mouse of field.mice) {
      if (mouse.label === '') continue;
      const centre = mouse.x + field.size / 2;
      const [laneLeft, laneRight] = mouse.lane ?? [0, stripWidth];
      const room = Math.max(0, laneRight - laneLeft - LABEL_GAP * 2) - LABEL_PAD * 2;

      // The name comes first: the time is dropped before the name is cut, the picture last of all.
      const withNote = mouse.note === '' ? mouse.label : `${mouse.label} · ${mouse.note}`;
      let mark = ACTIVITY_MARK[mouse.activity];
      const markWidth = (): number => (mark === '' ? 0 : Math.ceil(ctx.measureText(mark).width) + MARK_GAP);
      let text = withNote;
      if (ctx.measureText(text).width + markWidth() > room) text = fit(mouse.label, room - markWidth());
      if (text === '') {
        mark = '';
        text = fit(mouse.label, room);
      }
      if (text === '') continue;

      const width = Math.ceil(ctx.measureText(text).width) + markWidth() + LABEL_PAD * 2;
      // A mouse still on its way to its stretch (or leaving) keeps its name over itself meanwhile.
      const home = centre >= laneLeft && centre <= laneRight;
      const [left, right] = home ? [laneLeft + LABEL_GAP, laneRight - LABEL_GAP] : [1, stripWidth - 1];
      labels.push({ mouse, mark, text, width, x: Math.max(left, Math.min(centre - width / 2, right - width)) });
    }
    return labels;
  };

  /** A pill with the session's name over the mouse's back. */
  const drawLabel = ({ mouse, mark, text, x, width }: Label, now: number): void => {
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
    ctx.textAlign = 'left';
    let at = x + LABEL_PAD;
    if (mark !== '') {
      ctx.fillText(mark, at, y + LABEL_HEIGHT / 2 + 0.5);
      at += Math.ceil(ctx.measureText(mark).width) + MARK_GAP;
    }
    ctx.fillText(text, at, y + LABEL_HEIGHT / 2 + 0.5);
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
    for (const label of placeLabels(canvas.clientWidth)) drawLabel(label, now);

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

start();
