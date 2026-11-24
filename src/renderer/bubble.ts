import type { OverlayApi } from '../shared/types';

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

/** The bubble keeps this far from the window's edges, and its tail this far from its corners. */
const EDGE = 4;
const CORNER = 18;

function start(): void {
  const wrap = document.querySelector<HTMLElement>('#wrap');
  const bubble = document.querySelector<HTMLElement>('#bubble');
  const text = document.querySelector<HTMLElement>('#text');
  const tail = document.querySelector<HTMLElement>('#tail');
  if (!wrap || !bubble || !text || !tail) throw new Error('Bubble markup missing');

  let shown = '';
  window.overlay.onBubble((msg) => {
    // The same words again only mean the pet moved: slide, do not pop.
    const key = `${msg.tone}:${msg.text}`;
    const fresh = key !== shown;
    if (fresh) {
      shown = key;
      text.textContent = msg.text; // never markup: a session's name comes from outside the app
      document.body.dataset['tone'] = msg.tone;
    }

    // The tail points at the pet; the bubble stays over the tail as far as the window lets it.
    const room = document.documentElement.clientWidth;
    const width = bubble.offsetWidth;
    const left = Math.max(EDGE, Math.min(room - width - EDGE, msg.tail - width / 2));
    bubble.style.left = `${left}px`;
    tail.style.left = `${Math.max(left + CORNER, Math.min(left + width - CORNER, msg.tail))}px`;

    if (fresh) {
      wrap.classList.remove('pop');
      void wrap.offsetWidth; // restart the animation
      wrap.classList.add('pop');
    }
  });
}

start();
