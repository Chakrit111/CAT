import type { FrameMessage, PetApi, PetState } from '../shared/types';
import { wheelGeometry } from '../shared/wheel';

declare global {
  interface Window {
    pet: PetApi;
  }
}

/** Sound shorter than this is a click or a cough, not a command. */
const VOICE_MIN_SPEECH_MS = 120;
/** This much quiet after speech ends the recording. */
const VOICE_END_SILENCE_MS = 700;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load sprite: ${url}`));
    img.src = url;
  });
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#pet');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) throw new Error('Canvas 2D context unavailable');

  const { size, frames, wheel: wheelUrl, wheelEnter } = await window.pet.getManifest();
  const enterImages = wheelEnter ? await Promise.all(wheelEnter.map(loadImage)) : [];
  const ENTER_STEP_MS = 220;
  const wheelImages = wheelUrl ? await Promise.all(wheelUrl.map(loadImage)) : [];
  /** When the current run in the wheel began, to play the spin-up frames from the start. */
  let wheelSince = 0;
  const WHEEL_STEP_MS = 50;

  // States can share fallback frames, so de-duplicate loads by URL.
  const cache = new Map<string, Promise<HTMLImageElement>>();
  const load = (url: string): Promise<HTMLImageElement> => {
    let pending = cache.get(url);
    if (!pending) {
      pending = loadImage(url);
      cache.set(url, pending);
    }
    return pending;
  };
  const images = new Map<PetState, HTMLImageElement[]>();
  await Promise.all(
    (Object.keys(frames) as PetState[]).map(async (state) => {
      images.set(state, await Promise.all(frames[state].map(load)));
    }),
  );

  // --- sounds ---------------------------------------------------------------
  // One voice at a time, like a real cat: a new sound cuts off the one playing.
  let playing: HTMLAudioElement | null = null;
  const stopSound = (): void => {
    playing?.pause();
    playing = null;
  };
  window.pet.onSound(({ url, volume }) => {
    stopSound();
    if (url === null) return;
    const audio = new Audio(url);
    audio.volume = volume;
    playing = audio;
    audio.addEventListener('ended', () => {
      if (playing === audio) playing = null;
    });
    audio.play().catch((err: unknown) => {
      console.error(`[sound] could not play ${url}: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  // --- voice: mic badge above the cat ----------------------------------------
  type VoiceUi = 'off' | 'listening' | 'thinking';
  let voiceUi: VoiceUi = 'off';
  /** Mic input level, 0-1, for the pulse around the badge. */
  let level = 0;
  /** Bumped when a voice session starts or ends, so a recording in progress can tell it was cancelled. */
  let voiceSession = 0;
  let lastFrame: FrameMessage | undefined;

  const drawMic = (px: number): void => {
    if (voiceUi === 'off') return;
    const u = px / 160; // the badge is laid out for a 160-unit window
    const cx = px / 2;
    const cy = 20 * u;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (voiceUi === 'listening') {
      ctx.beginPath();
      ctx.arc(cx, cy, (15 + level * 5) * u, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(229, 57, 53, 0.3)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 13 * u, 0, Math.PI * 2);
    ctx.fillStyle = voiceUi === 'listening' ? '#e53935' : '#546e7a';
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6 * u;
    ctx.lineCap = 'round';
    if (voiceUi === 'thinking') {
      // Three dots, one lit at a time.
      const lit = Math.floor(performance.now() / 250) % 3;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i === lit ? 1 : 0.45;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * 6 * u, cy, 2 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    // Microphone: capsule, cradle, stand.
    ctx.beginPath();
    ctx.roundRect(cx - 3 * u, cy - 8 * u, 6 * u, 10 * u, 3 * u);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - u, 5.5 * u, 0, Math.PI);
    ctx.moveTo(cx, cy + 4.5 * u);
    ctx.lineTo(cx, cy + 8 * u);
    ctx.stroke();
  };

  // --- the running wheel (pets whose run is 'wheel') --------------------------
  /** Wooden stand, spokes and a rim with rungs, turned by `angle`; drawn behind the pet. */
  const drawWheel = (px: number, angle: number): void => {
    const g = wheelGeometry(px, 1);
    const inner = g.radius - g.ring / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = g.ring * 0.8;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(g.cx + side * g.radius * 0.55, px * 0.985);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(121, 85, 72, 0.7)';
    ctx.lineWidth = g.ring * 0.35;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = angle + (i * Math.PI) / 4;
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(g.cx + Math.cos(a) * inner, g.cy + Math.sin(a) * inner);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#6d4c41';
    ctx.lineWidth = g.ring;
    ctx.stroke();
    ctx.strokeStyle = '#ffe0b2';
    ctx.lineWidth = g.ring * 0.55;
    ctx.stroke();

    // Rungs across the rim make the turning easy to see.
    ctx.strokeStyle = '#a1887f';
    ctx.lineWidth = g.ring * 0.22;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = angle + (i * Math.PI) / 12;
      ctx.moveTo(g.cx + Math.cos(a) * (g.radius - g.ring * 0.3), g.cy + Math.sin(a) * (g.radius - g.ring * 0.3));
      ctx.lineTo(g.cx + Math.cos(a) * (g.radius + g.ring * 0.3), g.cy + Math.sin(a) * (g.radius + g.ring * 0.3));
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.ring * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = '#6d4c41';
    ctx.fill();
    ctx.restore();
  };
  let wheelRaf = 0;

  const draw = (msg: FrameMessage): void => {
    const { state, frame, flip, wheel } = msg;
    lastFrame = msg;
    const img = images.get(state)?.[frame];
    if (!img) return;

    // devicePixelRatio changes when the pet is dragged to a display with different scaling.
    const px = Math.round(size * window.devicePixelRatio);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    if (wheel) {
      ctx.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? px : 0, 0);
      const now = performance.now();
      if (!wheelSince) wheelSince = now;
      const [hx, hy, hr] = wheel.hub;
      const face = wheelImages[0];
      const enterStep = Math.floor((now - wheelSince) / ENTER_STEP_MS);
      const entering = enterImages[enterStep];
      if (entering) {
        // Getting into the wheel: the pet alone over the still wheel, once, before the run.
        if (face) ctx.drawImage(face, 0, 0, px, px);
        ctx.drawImage(entering, 0, 0, px, px);
        wheelRaf ||= requestAnimationFrame(() => {
          wheelRaf = 0;
          if (lastFrame?.wheel) draw(lastFrame);
        });
        drawMic(px);
        return;
      }
      if (face && hx !== undefined && hy !== undefined && hr !== undefined) {
        // The pack's own wheel, turning: the picture as is (stand), then its face circle rotated on top.
        ctx.drawImage(face, 0, 0, px, px);
        const angle = ((now - wheelSince) / 1000) * wheel.turnsPerSecond * Math.PI * 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(hx * px, hy * px, hr * px, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(hx * px, hy * px);
        ctx.rotate(angle);
        ctx.translate(-hx * px, -hy * px);
        ctx.drawImage(face, 0, 0, px, px);
        ctx.restore();
        wheelRaf ||= requestAnimationFrame(() => {
          wheelRaf = 0;
          if (lastFrame?.wheel) draw(lastFrame);
        });
      } else if (wheelImages.length > 0) {
        // The pack's own wheel: its frames loop, each a step of the turn.
        const n = wheelImages.length;
        const picture = wheelImages[Math.floor((now - wheelSince) / WHEEL_STEP_MS) % n];
        if (picture) ctx.drawImage(picture, 0, 0, px, px);
        if (n > 1) {
          wheelRaf ||= requestAnimationFrame(() => {
            wheelRaf = 0;
            if (lastFrame?.wheel) draw(lastFrame);
          });
        }
      } else {
        // Running to the right pushes the bottom of the wheel left: clockwise on screen.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawWheel(px, (performance.now() / 1000) * wheel.turnsPerSecond * Math.PI * 2 * (flip ? -1 : 1));
        // Main only sends a frame when the pose changes; the drawn wheel turns on its own clock.
        wheelRaf ||= requestAnimationFrame(() => {
          wheelRaf = 0;
          if (lastFrame?.wheel) draw(lastFrame);
        });
      }
      const g = wheelGeometry(px, wheel.scale, wheel.floor, wheel.centerX);
      ctx.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? px : 0, 0);
      const [ox, oy, orx, ory] = wheel.opening;
      ctx.save();
      if (ox !== undefined && oy !== undefined && orx !== undefined && ory !== undefined) {
        // The pet is inside the wheel: the rim hides whatever sticks out of the opening.
        ctx.beginPath();
        ctx.ellipse(ox * px, oy * px, orx * px, ory * px, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(img, g.spriteX, g.spriteY, g.spriteSize, g.spriteSize);
      ctx.restore();
    } else {
      wheelSince = 0;
      ctx.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? px : 0, 0);
      ctx.drawImage(img, 0, 0, px, px);
    }
    drawMic(px);
  };
  const redraw = (): void => {
    if (lastFrame) draw(lastFrame);
  };
  window.pet.onFrame(draw);

  // --- voice: recording ------------------------------------------------------
  /** Resolves true once someone has spoken and gone quiet again, false if `maxMs` passes without speech. */
  const hearUtterance = (
    analyser: AnalyserNode,
    maxMs: number,
    active: () => boolean,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const samples = new Float32Array(analyser.fftSize);
      const started = performance.now();
      let last = started;
      let noise = Number.POSITIVE_INFINITY;
      let speechMs = 0;
      let quietMs = 0;
      const poll = setInterval(() => {
        const now = performance.now();
        const dt = now - last;
        last = now;

        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        level = Math.min(1, rms * 10);
        redraw();

        // The quietest moment so far stands in for room noise; speech has to clear it comfortably.
        noise = Math.min(noise, rms);
        if (rms > Math.max(0.006, noise * 4)) {
          speechMs += dt;
          quietMs = 0;
        } else if (speechMs > 0) {
          quietMs += dt;
        }

        const spoke = speechMs >= VOICE_MIN_SPEECH_MS;
        const over = (spoke && quietMs >= VOICE_END_SILENCE_MS) || now - started >= maxMs;
        if (active() && !over) return;
        clearInterval(poll);
        resolve(active() && spoke);
      }, 50);
    });

  const listen = async (maxMs: number): Promise<void> => {
    const session = ++voiceSession;
    const active = (): boolean => session === voiceSession;
    let stream: MediaStream | undefined;
    let audio: AudioContext | undefined;
    voiceUi = 'listening';
    level = 0;
    redraw();
    try {
      // Chromium's call processing is left off: recognition scored better on the raw signal,
      // and its auto gain drove test recordings into clipping.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (!active()) return;
      audio = new AudioContext();
      await audio.resume();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      audio.createMediaStreamSource(stream).connect(analyser);

      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      const spoke = await hearUtterance(analyser, maxMs, active);
      recorder.stop();
      await stopped;
      if (!active()) return;
      if (!spoke) {
        window.pet.voiceAudio(null);
        return;
      }

      voiceUi = 'thinking';
      redraw();
      // Decoding through a 16 kHz context resamples the recording to what Whisper expects.
      const encoded = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 16_000).decodeAudioData(encoded);
      if (active()) window.pet.voiceAudio(decoded.getChannelData(0));
    } catch (err) {
      if (active()) {
        window.pet.voiceAudio(null, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      void audio?.close();
    }
  };

  window.pet.onVoiceListen(({ maxMs }) => {
    stopSound(); // a purr or a meow would end up in the recording
    void listen(maxMs);
  });
  window.pet.onVoiceEnd(() => {
    voiceSession += 1;
    voiceUi = 'off';
    redraw();
  });
  // Main only sends a frame when the pose changes, so the "thinking" dots need their own clock.
  setInterval(() => {
    if (voiceUi === 'thinking') redraw();
  }, 125);

  // Main owns position and state; the renderer only reports raw pointer edges.
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    window.pet.pointerDown();
  });
  const release = (): void => window.pet.pointerUp(); // idempotent on the main side
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.pet.contextMenu();
  });

  window.pet.ready();
}

main().catch((err: unknown) => {
  // Forwarded to the main process stdout via the console-message hook.
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
