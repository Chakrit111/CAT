import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PET_STATES } from '../shared/types';
import type { PhraseTable } from './commands';
import { DEFAULT_CONFIG, type PetConfig } from './config';
import type { CommandableState } from './pet';

/**
 * A pet pack: everything that makes one pet that pet. On disk (pets/<id>/ in the repo, dist/pet/
 * once built) it is a folder with pet.json, icon.ico, sprites/<state>/*.png and sounds/<sound>/*.
 */
export interface PetPack {
  /** Folder the pack was loaded from. */
  dir: string;
  id: string;
  /** Shown in the tray, window titles and dialogs; also the exe's name. */
  productName: string;
  /** Names the settings folder in %APPDATA% and the single-instance lock: unique per pet. */
  packageName: string;
  /** "1.0.0"; the updater compares it with the published releases. */
  version: string;
  /** GitHub repository whose releases the portable exe updates itself from; null = it never updates. */
  update: { repo: string } | null;
  features: { voice: boolean; hunt: boolean; sounds: boolean };
  /** Right-click menu entries, in order. A command not listed is not in the menu. */
  menu: ReadonlyArray<readonly [CommandableState, string]>;
  /** Voice phrases per command; empty when voice is off. */
  phrases: PhraseTable;
  /** Engine defaults with the pack's `tuning` applied. */
  config: PetConfig;
}

const COMMANDS = PET_STATES.filter((s): s is CommandableState => s !== 'drag' && s !== 'fall');
const TOP_LEVEL = ['$comment', 'id', 'productName', 'packageName', 'appId', 'version', 'update', 'features', 'menu', 'voice', 'tuning'];

/** Thrown with every problem found in a pet.json, one per line, so a pack can be fixed in one go. */
export class PackError extends Error {}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadPack(dir: string): PetPack {
  const file = path.join(dir, 'pet.json');
  let raw: Json;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PackError(`Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const problems: string[] = [];
  const need = (ok: boolean, message: string): boolean => {
    if (!ok) problems.push(message);
    return ok;
  };
  if (!isObject(raw)) throw new PackError(`${file}: must be a JSON object`);
  const pet = raw;

  for (const key of Object.keys(pet)) need(TOP_LEVEL.includes(key), `unknown key "${key}"`);
  const text = (key: string): string => {
    const v = pet[key];
    need(typeof v === 'string' && v.trim() !== '', `"${key}" must be a non-empty string`);
    return typeof v === 'string' ? v : '';
  };
  const id = text('id');
  const productName = text('productName');
  const packageName = text('packageName');
  need(/^[a-z0-9][a-z0-9-]*$/.test(packageName), '"packageName" may only use a-z, 0-9 and "-" (it names a folder)');

  const version = typeof pet['version'] === 'string' ? pet['version'] : '0.0.0';
  let update: PetPack['update'] = null;
  if (pet['update'] !== undefined) {
    const repo = isObject(pet['update']) ? pet['update']['repo'] : undefined;
    if (need(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo), 'update.repo must be a GitHub repository, "owner/name"')) {
      update = { repo: repo as string };
    }
  }

  const features = { voice: false, hunt: true, sounds: true };
  const f = pet['features'];
  if (f !== undefined && need(isObject(f), '"features" must be an object')) {
    for (const [k, v] of Object.entries(f as Record<string, Json>)) {
      if (!need(k in features, `unknown feature "${k}" (voice, hunt, sounds)`)) continue;
      if (need(typeof v === 'boolean', `features.${k} must be true or false`)) features[k as keyof typeof features] = v as boolean;
    }
  }

  const isCommand = (k: string): k is CommandableState => (COMMANDS as readonly string[]).includes(k);
  const menu: Array<readonly [CommandableState, string]> = [];
  if (need(isObject(pet['menu']), '"menu" must be an object of command: label')) {
    for (const [k, v] of Object.entries(pet['menu'] as Record<string, Json>)) {
      if (!need(isCommand(k), `menu: "${k}" is not a command (${COMMANDS.join(', ')})`)) continue;
      if (!need(typeof v === 'string' && v !== '', `menu.${k} must be a label`)) continue;
      if (k === 'run' && !features.hunt) continue;
      menu.push([k as CommandableState, v as string]);
    }
  }

  const config = structuredClone(DEFAULT_CONFIG) as PetConfig;
  const phrases: Array<readonly [CommandableState, readonly string[]]> = [];
  const voice = pet['voice'];
  if (features.voice && need(isObject(voice), '"voice" is required when features.voice is true')) {
    const v = voice as Record<string, Json>;
    const language = v['language'];
    if (language !== undefined && need(typeof language === 'string', 'voice.language must be a Whisper language code, e.g. "th"')) {
      config.voice.language = language as string;
    }
    if (need(isObject(v['phrases']), 'voice.phrases must be an object of command: [phrases]')) {
      for (const [k, list] of Object.entries(v['phrases'] as Record<string, Json>)) {
        if (!need(isCommand(k), `voice.phrases: "${k}" is not a command`)) continue;
        const ok = Array.isArray(list) && list.length > 0 && list.every((p) => typeof p === 'string' && p !== '');
        if (!need(ok, `voice.phrases.${k} must be a non-empty list of phrases`)) continue;
        if (k === 'run' && !features.hunt) continue;
        phrases.push([k as CommandableState, list as string[]]);
      }
    }
  }

  if (pet['tuning'] !== undefined) merge(config as unknown as Record<string, Json>, pet['tuning'], 'tuning', problems);
  need(config.runMode === 'hunt' || config.runMode === 'wheel', 'tuning.runMode must be "hunt" or "wheel"');
  need(config.wheel.scale >= 0.3 && config.wheel.scale <= 1, 'tuning.wheel.scale must be between 0.3 and 1');
  need(config.wheel.minMs <= config.wheel.maxMs, 'tuning.wheel.minMs must not be above maxMs');
  if (!features.hunt) config.idleNext = config.idleNext.filter(([state]) => state !== 'run');
  for (const entry of config.idleNext as readonly Json[]) {
    const ok =
      Array.isArray(entry) &&
      (PET_STATES as readonly Json[]).includes(entry[0]) &&
      typeof entry[1] === 'number' &&
      entry[1] >= 0;
    need(ok, `tuning.idleNext: bad entry ${JSON.stringify(entry)} (expected ["state", weight])`);
  }

  if (problems.length > 0) throw new PackError(`${file}:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  return { dir, id, productName, packageName, version, update, features, menu, phrases, config };
}

/**
 * Applies `override` onto `target` in place. Only keys the engine knows are accepted, with the same
 * type as the default, so a typo in pet.json is reported instead of silently ignored.
 */
function merge(target: Record<string, Json>, override: Json, at: string, problems: string[]): void {
  if (!isObject(override)) {
    problems.push(`${at} must be an object`);
    return;
  }
  for (const [key, value] of Object.entries(override)) {
    const where = `${at}.${key}`;
    if (!(key in target)) {
      problems.push(`${where} is not a setting (see src/main/config.ts)`);
      continue;
    }
    const current = target[key];
    if (Array.isArray(current)) {
      if (Array.isArray(value)) target[key] = value;
      else problems.push(`${where} must be a list`);
    } else if (isObject(current)) {
      merge(current, value, where, problems);
    } else if (typeof value === typeof current) {
      target[key] = value;
    } else {
      problems.push(`${where} must be a ${typeof current}`);
    }
  }
}
