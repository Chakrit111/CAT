import { nativeImage } from 'electron';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PET_STATES, type PetState, type SpriteManifest } from '../shared/types';

interface Frame {
  url: string;
  /** Alpha channel at window resolution (size x size), or null if it could not be read. */
  mask: Uint8Array | null;
}

export interface SpriteSet {
  manifest: SpriteManifest;
  frameCounts: Record<PetState, number>;
  /** Alpha hit-test. (x, y) are window-local DIP coordinates. */
  isOpaque(state: PetState, frame: number, flip: boolean, x: number, y: number): boolean;
}

function listPngs(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((name) => /\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}

function loadFrame(file: string, size: number): Frame {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error(`Cannot decode sprite: ${file}`);

  // Same stretch-to-square the renderer applies, so the mask lines up with what is drawn.
  const bitmap = image.resize({ width: size, height: size, quality: 'good' }).toBitmap();
  let mask: Uint8Array | null = null;
  if (bitmap.length === size * size * 4) {
    mask = new Uint8Array(size * size);
    // Channel order is platform-dependent (BGRA or RGBA); alpha is byte 3 in both.
    for (let i = 0; i < mask.length; i++) mask[i] = bitmap[i * 4 + 3] ?? 0;
  } else {
    console.warn(`[sprites] unexpected bitmap size for ${file}; whole window will be clickable`);
  }
  return { url: pathToFileURL(file).href, mask };
}

/**
 * Loads `<root>/<state>/*.png` (sorted numerically by file name).
 * A state with no frames falls back to the idle frames; idle itself is required.
 */
export function loadSprites(root: string, size: number, alphaThreshold: number): SpriteSet {
  const idle = listPngs(path.join(root, 'idle')).map((file) => loadFrame(file, size));
  if (idle.length === 0) {
    throw new Error(`No sprites found. Expected at least one PNG in ${path.join(root, 'idle')}`);
  }

  const frames = {} as Record<PetState, Frame[]>;
  for (const state of PET_STATES) {
    if (state === 'idle') {
      frames[state] = idle;
      continue;
    }
    const own = listPngs(path.join(root, state)).map((file) => loadFrame(file, size));
    if (own.length === 0) console.warn(`[sprites] no frames for "${state}", falling back to idle`);
    frames[state] = own.length > 0 ? own : idle;
  }

  const urls = {} as Record<PetState, string[]>;
  const frameCounts = {} as Record<PetState, number>;
  for (const state of PET_STATES) {
    urls[state] = frames[state].map((frame) => frame.url);
    frameCounts[state] = frames[state].length;
  }

  return {
    manifest: { size, frames: urls },
    frameCounts,
    isOpaque(state, frame, flip, x, y) {
      const px = Math.floor(flip ? size - 1 - x : x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= size || py >= size) return false;
      const mask = frames[state][frame]?.mask;
      if (mask === undefined) return false;
      if (mask === null) return true;
      return (mask[py * size + px] ?? 0) > alphaThreshold;
    },
  };
}
