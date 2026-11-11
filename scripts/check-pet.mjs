// Checks a pet pack before it is built: pet.json basics, icon, sprite folders and frames, sounds.
// usage: node scripts/check-pet.mjs <id>        (npm run check-pet -- <id>)
// Exits 1 when there are errors. Settings under "tuning" are checked by the app itself when it
// starts (src/main/pack.ts), which lists every problem in one dialog.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATES = ['idle', 'walk', 'sit', 'stand', 'sleep', 'roll', 'chase', 'jump', 'run', 'drag', 'fall'];
/** Without these the pet looks broken (everything else falls back to idle). */
export const RECOMMENDED = ['walk', 'sit', 'sleep', 'drag', 'fall'];
export const SOUNDS = ['meow', 'mew', 'question', 'annoyed', 'happy', 'purr'];
const AUDIO = /\.(wav|mp3|ogg)$/i;
const FRAME = /^\d+\.png$/i;

function png(file) {
  const b = readFileSync(file);
  if (b.length < 26 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

function dirs(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
}

export function checkPet(root, id) {
  const dir = path.join(root, 'pets', id);
  const errors = [];
  const warnings = [];
  const info = [];
  if (!existsSync(dir)) return { errors: [`no pack folder ${dir}`], warnings, info };

  let pet = {};
  try {
    pet = JSON.parse(readFileSync(path.join(dir, 'pet.json'), 'utf8'));
  } catch (err) {
    errors.push(`pet.json: ${err.message}`);
    return { errors, warnings, info };
  }
  for (const key of ['id', 'productName', 'packageName', 'appId', 'version']) {
    if (typeof pet[key] !== 'string' || pet[key].trim() === '') errors.push(`pet.json: "${key}" is missing`);
  }
  if (pet.id && pet.id !== id) errors.push(`pet.json: id "${pet.id}" does not match the folder name "${id}"`);
  if (pet.packageName && !/^[a-z0-9][a-z0-9-]*$/.test(pet.packageName)) {
    errors.push('pet.json: packageName may only use a-z, 0-9 and "-"');
  }
  if (pet.version && !/^\d+\.\d+\.\d+$/.test(pet.version)) errors.push('pet.json: version must look like 1.0.0');
  const features = { voice: false, hunt: true, sounds: true, ...(pet.features ?? {}) };
  if (features.voice && Object.keys(pet.voice?.phrases ?? {}).length === 0) {
    errors.push('pet.json: features.voice is on but voice.phrases is empty');
  }

  const icon = path.join(dir, 'icon.ico');
  if (!existsSync(icon)) {
    errors.push('icon.ico is missing (python -I scripts/make_icon.py <frame.png> icon.ico <preview.png> <head box>)');
  } else {
    const b = readFileSync(icon);
    if (b.readUInt32LE(0) !== 0x00010000) errors.push('icon.ico is not an .ico file');
    else {
      const sizes = Array.from({ length: b.readUInt16LE(4) }, (_, i) => b[6 + i * 16] || 256);
      if (!sizes.includes(256)) errors.push(`icon.ico needs a 256x256 image for the exe (has ${sizes.join(', ')})`);
    }
  }

  const spriteDir = path.join(dir, 'sprites');
  let frames = 0;
  for (const state of STATES) {
    const sdir = path.join(spriteDir, state);
    const files = existsSync(sdir) ? readdirSync(sdir) : [];
    const pngs = files.filter((f) => FRAME.test(f));
    for (const f of files.filter((f) => !FRAME.test(f))) {
      errors.push(`sprites/${state}/${f}: frames must be named 0.png, 1.png, ... (put originals in art/${state}/)`);
    }
    if (pngs.length === 0) {
      if (state === 'idle') errors.push('sprites/idle has no frames: every other state falls back to it');
      else if (RECOMMENDED.includes(state)) warnings.push(`sprites/${state} has no frames (uses idle)`);
      continue;
    }
    for (const f of pngs) {
      const meta = png(path.join(sdir, f));
      if (!meta) errors.push(`sprites/${state}/${f} is not a PNG`);
      else if (meta.width !== meta.height) errors.push(`sprites/${state}/${f} is ${meta.width}x${meta.height}; frames must be square`);
      else {
        if (meta.width !== 320) warnings.push(`sprites/${state}/${f} is ${meta.width}px; the set uses 320x320`);
        if (!meta.alpha) errors.push(`sprites/${state}/${f} has no transparency (needs RGBA)`);
      }
    }
    frames += pngs.length;
  }
  for (const extra of dirs(spriteDir).filter((d) => !STATES.includes(d))) warnings.push(`sprites/${extra} is not a state and is ignored`);
  info.push(`${frames} frames`);

  if (features.sounds) {
    const soundDir = path.join(dir, 'sounds');
    let count = 0;
    for (const name of SOUNDS) {
      const sdir = path.join(soundDir, name);
      const files = existsSync(sdir) ? readdirSync(sdir) : [];
      for (const f of files.filter((f) => !AUDIO.test(f))) warnings.push(`sounds/${name}/${f} is not .wav/.mp3/.ogg and is ignored`);
      const audio = files.filter((f) => AUDIO.test(f));
      if (audio.length === 0) warnings.push(`sounds/${name} is empty (silent)`);
      for (const f of audio) {
        const size = statSync(path.join(sdir, f)).size;
        if (size > 1_500_000) warnings.push(`sounds/${name}/${f} is ${(size / 1e6).toFixed(1)} MB; long sounds play to the end`);
      }
      count += audio.length;
    }
    for (const extra of dirs(soundDir).filter((d) => !SOUNDS.includes(d))) warnings.push(`sounds/${extra} is not a sound name and is ignored`);
    info.push(`${count} sound files`);
  }
  info.push(`features: ${Object.entries(features).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ')}`);
  return { errors, warnings, info, pet };
}

export function report(id, { errors, warnings, info }) {
  console.log(`pet "${id}": ${info.join('; ')}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  for (const e of errors) console.log(`  ERROR:   ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : 'ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    console.error('usage: npm run check-pet -- <id>');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkPet(root, id);
  report(id, result);
  process.exit(result.errors.length ? 1 : 0);
}
