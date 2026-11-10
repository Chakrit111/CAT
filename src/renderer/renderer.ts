import type { FrameMessage, PetApi, PetState } from '../shared/types';

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

  const { size, frames } = await window.pet.getManifest();

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

  const draw = (msg: FrameMessage): void => {
    const { state, frame, flip } = msg;
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
    ctx.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? px : 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(img, 0, 0, px, px);
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

  window.pet.onVoiceListen(({ maxMs }) => void listen(maxMs));
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
