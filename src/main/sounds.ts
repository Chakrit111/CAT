import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The cat's sounds; each is a folder of interchangeable recordings. */
export const SOUND_NAMES = ['meow', 'mew', 'question', 'annoyed', 'happy', 'purr'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

const AUDIO_FILE = /\.(wav|mp3|ogg)$/i;

/**
 * Finds `<root>/<name>/*.{wav,mp3,ogg}` for every sound. A sound without files stays silent.
 * Each play picks one of its files at random, never the same one twice in a row.
 */
export class Sounds {
  private readonly files: Record<SoundName, string[]>;
  private readonly last = new Map<SoundName, string>();

  constructor(root: string, private readonly rng: () => number = Math.random) {
    this.files = Object.fromEntries(
      SOUND_NAMES.map((name) => [name, list(path.join(root, name))]),
    ) as Record<SoundName, string[]>;
    const missing = SOUND_NAMES.filter((name) => this.files[name].length === 0);
    if (missing.length > 0) console.warn(`[sounds] no files for ${missing.join(', ')}`);
  }

  /** file:// URL of one recording of `name`, or null if it has none. */
  pick(name: SoundName): string | null {
    const files = this.files[name];
    if (files.length === 0) return null;
    const previous = this.last.get(name);
    const choices = files.length > 1 ? files.filter((f) => f !== previous) : files;
    const file = choices[Math.floor(this.rng() * choices.length)] ?? files[0];
    if (file === undefined) return null;
    this.last.set(name, file);
    return pathToFileURL(file).href;
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => AUDIO_FILE.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}
