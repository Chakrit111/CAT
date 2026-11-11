// Synthesises the pet's cartoon cat sounds as 16-bit mono WAV files.
// usage: node scripts/meow-synth.mjs pets/<id>/sounds [demo.wav]
// Writes <out>/<sound>/<n>.wav for every sound and variant, and optionally one file with one of each.
// The output is deterministic (fixed seeds); edit the specs under "the sounds" and run it again.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SR = 44_100;

// --- helpers -----------------------------------------------------------------------------------

/** Deterministic RNG so the same seed always gives the same variant. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Piecewise-linear curve through [t, value] keyframes, t in 0..1. */
function curve(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      const [t0, v0] = keys[i - 1];
      if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
    return keys[keys.length - 1][1];
  };
}

/** Two-pole resonator (band-pass, ~unity peak gain) whose centre and bandwidth may change per sample. */
function resonator() {
  let y1 = 0;
  let y2 = 0;
  return (x, freq, bw) => {
    const r = Math.exp((-Math.PI * bw) / SR);
    const a1 = 2 * r * Math.cos((2 * Math.PI * freq) / SR);
    const a2 = -r * r;
    const y = (1 - r) * x + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function envelope(n, attackS, releaseS) {
  const a = Math.max(1, Math.round(attackS * SR));
  const r = Math.max(1, Math.round(releaseS * SR));
  return (i) => Math.min(1, i / a, (n - i) / r);
}

// Vowel formants for a small cat: [F1, F2, F3] in Hz.
const VOWEL = {
  m: [450, 1400, 2900],
  i: [950, 2700, 3700],
  a: [1300, 2200, 3400],
  u: [750, 1350, 2800],
};

function vowelCurve(keys) {
  const f = [0, 1, 2].map((k) => curve(keys.map(([t, v]) => [t, VOWEL[v][k]])));
  return (t) => f.map((g) => g(t));
}

// --- the voice ---------------------------------------------------------------------------------

/**
 * One vocalisation: a harmonic source at pitch f0(t), shaped by moving formants.
 * spec: { dur, f0: [[t,hz]...], vowel: [[t,'m'|'i'|'a'|'u']...], open: [[t,0..1]...],
 *         breath, trill: {from,to,rate,depth}, vibrato, attack, release, seed }
 */
function voice(spec) {
  const n = Math.round(spec.dur * SR);
  const out = new Float32Array(n);
  const rand = rng(spec.seed ?? 1);
  const f0 = curve(spec.f0);
  const formants = vowelCurve(spec.vowel);
  const open = curve(spec.open ?? [[0, 0.3], [0.2, 1], [1, 1]]);
  const env = envelope(n, spec.attack ?? 0.03, spec.release ?? 0.12);
  const bank = [resonator(), resonator(), resonator()];
  const gains = [1, 0.55, 0.25];
  const bws = [180, 260, 380];
  const vib = spec.vibrato ?? 0.015;
  const breath = spec.breath ?? 0.04;
  let phase = 0;
  let jitter = 0;

  for (let i = 0; i < n; i++) {
    const t = i / n;
    const ts = i / SR;
    jitter += (rand() - 0.5) * 0.002 - jitter * 0.002; // slow random wander of pitch
    const hz = f0(t) * (1 + vib * Math.sin(2 * Math.PI * 5.5 * ts) + jitter);
    phase += (2 * Math.PI * hz) / SR;

    // Harmonics up to ~9 kHz, falling off like a voice.
    let src = 0;
    const kmax = Math.min(14, Math.floor(9000 / hz));
    for (let k = 1; k <= kmax; k++) src += Math.sin(k * phase) / k ** 1.1;
    src += (rand() * 2 - 1) * breath * 3;

    const o = open(t);
    const fs = formants(t);
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const g = k === 0 ? gains[k] : gains[k] * (0.25 + 0.75 * o);
      y += g * bank[k](src, fs[k], bws[k]);
    }

    let am = 1;
    if (spec.trill && t >= spec.trill.from && t <= spec.trill.to) {
      am = 1 - spec.trill.depth * (0.5 + 0.5 * Math.cos(2 * Math.PI * spec.trill.rate * ts));
    }
    out[i] = y * env(i) * (0.35 + 0.65 * o) * am;
  }
  return out;
}

/** Purring: ~25 pulses a second of low, filtered noise, louder breathing out than in. */
function purr({ dur = 3.6, rate = 25, seed = 7 } = {}) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const lo = resonator();
  const mid = resonator();
  const breathCycle = 1.8; // seconds: ~0.75 s in, ~1.05 s out
  let pulse = 0;
  for (let i = 0; i < n; i++) {
    const ts = i / SR;
    const c = (ts % breathCycle) / breathCycle;
    const inhale = c < 0.42;
    const local = inhale ? c / 0.42 : (c - 0.42) / 0.58;
    const breathEnv = Math.sin(Math.PI * local) ** 0.6 * (inhale ? 0.55 : 1);
    const hz = rate * (inhale ? 1.08 : 1);
    pulse += hz / SR;
    if (pulse >= 1) pulse -= 1;
    const click = Math.exp(-pulse * 9); // each pulse decays quickly
    const x = (rand() * 2 - 1) * click;
    out[i] = (lo(x, 140, 90) + mid(x, 480, 300) * 0.45) * breathEnv;
  }
  const env = envelope(n, 0.25, 0.4);
  for (let i = 0; i < n; i++) out[i] *= env(i);
  return out;
}

function concat(parts, gapS) {
  const gap = Math.round(gapS * SR);
  const total = parts.reduce((s, p) => s + p.length, 0) + gap * (parts.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  parts.forEach((p, i) => {
    out.set(p, at);
    at += p.length + (i < parts.length - 1 ? gap : 0);
  });
  return out;
}

function normalize(x, peak = 0.7) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? peak / m : 1;
  return x.map((v) => v * g);
}

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

// --- the sounds --------------------------------------------------------------------------------

const scale = (keys, k) => keys.map(([t, hz]) => [t, hz * k]);

const meow = (k, seed, dur = 0.68) =>
  voice({
    dur,
    seed,
    f0: scale([[0, 640], [0.35, 1000], [0.75, 760], [1, 600]], k),
    vowel: [[0, 'm'], [0.18, 'i'], [0.5, 'a'], [1, 'u']],
    open: [[0, 0.15], [0.2, 1], [0.8, 0.9], [1, 0.35]],
  });

const mew = (k, seed) =>
  voice({
    dur: 0.3,
    seed,
    f0: scale([[0, 950], [0.4, 1180], [1, 900]], k),
    vowel: [[0, 'm'], [0.3, 'i'], [1, 'i']],
    open: [[0, 0.2], [0.3, 1], [1, 0.6]],
    attack: 0.015,
    release: 0.08,
  });

const question = (k, seed) =>
  voice({
    dur: 0.5,
    seed,
    f0: scale([[0, 620], [0.35, 640], [0.85, 1080], [1, 1120]], k),
    vowel: [[0, 'm'], [0.35, 'm'], [0.6, 'a'], [1, 'i']],
    open: [[0, 0.2], [0.35, 0.3], [0.65, 1], [1, 0.9]],
    trill: { from: 0, to: 0.38, rate: 30, depth: 0.85 },
    release: 0.06,
  });

const annoyed = (k, seed) =>
  voice({
    dur: 0.9,
    seed,
    f0: scale([[0, 520], [0.3, 700], [0.7, 520], [1, 400]], k),
    vowel: [[0, 'm'], [0.2, 'a'], [0.65, 'a'], [1, 'u']],
    open: [[0, 0.2], [0.2, 1], [0.7, 0.9], [1, 0.4]],
    breath: 0.12,
    trill: { from: 0.6, to: 1, rate: 28, depth: 0.6 },
    vibrato: 0.03,
  });

const chirp = (k, seed) =>
  concat(
    [0, 1].map((j) =>
      voice({
        dur: 0.16,
        seed: seed + j,
        f0: scale([[0, 760], [1, 1350]], k * (1 + j * 0.06)),
        vowel: [[0, 'm'], [0.4, 'i'], [1, 'i']],
        open: [[0, 0.3], [0.4, 1], [1, 0.8]],
        attack: 0.01,
        release: 0.05,
      }),
    ),
    0.06,
  );

const SOUNDS = {
  meow: [meow(1, 11), meow(1.08, 12, 0.6), meow(0.94, 13, 0.75)],
  mew: [mew(1, 21), mew(1.07, 22)],
  question: [question(1, 31), question(1.06, 32)],
  annoyed: [annoyed(1, 41), annoyed(0.93, 42)],
  happy: [chirp(1, 51), chirp(1.05, 53)],
  purr: [purr()],
};

const outDir = process.argv[2];
const demo = [];
for (const [name, variants] of Object.entries(SOUNDS)) {
  const dir = path.join(outDir, name);
  mkdirSync(dir, { recursive: true });
  variants.forEach((v, i) => {
    const x = normalize(v, name === 'purr' ? 0.45 : 0.7);
    writeFileSync(path.join(dir, `${i}.wav`), wav(x));
    if (i === 0) demo.push(x);
    let peak = 0;
    let sq = 0;
    for (const s of x) {
      peak = Math.max(peak, Math.abs(s));
      sq += s * s;
    }
    const bad = x.some((s) => !Number.isFinite(s));
    console.log(
      `${name}/${i}.wav  ${(x.length / SR).toFixed(2)} s  peak ${peak.toFixed(2)}  rms ${Math.sqrt(sq / x.length).toFixed(3)}${bad ? '  NaN!' : ''}`,
    );
  });
}
if (process.argv[3]) {
  writeFileSync(process.argv[3], wav(concat(demo, 0.6)));
  console.log(`${process.argv[3]}: ${Object.keys(SOUNDS).join(', ')}`);
}
