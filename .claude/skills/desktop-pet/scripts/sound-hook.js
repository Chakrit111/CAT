// Injected into the pet window over CDP: records every sound the renderer starts and whether it really played.
window.__plays = [];
(() => {
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const rec = { sound: this.src.split('/').slice(-2).join('/'), at: Math.round(performance.now()) };
    window.__plays.push(rec);
    this.addEventListener('playing', () => (rec.playing = true), { once: true });
    this.addEventListener('pause', () => (rec.cutAfterMs = Math.round(performance.now()) - rec.at), { once: true });
    this.addEventListener('ended', () => (rec.endedAfterMs = Math.round(performance.now()) - rec.at), { once: true });
    this.addEventListener('error', () => (rec.error = String(this.error && this.error.message)), { once: true });
    const p = orig.call(this);
    p.catch((e) => (rec.rejected = String(e)));
    return p;
  };
})();
'hooked';
