import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import { net } from 'electron';

/**
 * Self-update of the portable exe from GitHub Releases.
 *
 * A pet's releases are tagged `<id>-v<version>` and carry the exe plus `<exe name>.sha256`. The
 * running pet downloads a newer exe next to its own as `<exe>.download`, checks it against the
 * checksum and keeps it as `<exe>.new`. Windows will not let a running exe be renamed or replaced,
 * so the swap is done by a small helper script that waits for the pet to exit: on quit, on
 * "Restart to update", or at the next start if the pet never got to quit (Windows shut down).
 */

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
/** GitHub wants a User-Agent; a generic one, so nothing about the user or the pet is sent. */
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'desktop-pet-updater' };

export interface ReleaseFile {
  version: string;
  exeUrl: string;
  /** Bytes, as the release lists it. */
  size: number;
  shaUrl: string;
}

const numbers = (version: string): number[] => version.split('.').map(Number);

/** true if version `a` is later than `b` (both "1.2.3"). */
export function newer(a: string, b: string): boolean {
  const x = numbers(a);
  const y = numbers(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The latest published release of pet `id` that is later than `current`, from GitHub's release
 * list. Asset URLs must start with `downloads` (the repo's own download path): the list is data
 * from the network, so nothing in it may point the download elsewhere.
 */
export function pickRelease(releases: unknown, id: string, current: string, downloads: string): ReleaseFile | null {
  if (!Array.isArray(releases)) return null;
  const tag = new RegExp(`^${id}-v(\\d+\\.\\d+\\.\\d+)$`);
  let best: ReleaseFile | null = null;
  for (const release of releases) {
    if (!isObject(release) || release['draft'] === true || release['prerelease'] === true) continue;
    const version = typeof release['tag_name'] === 'string' ? tag.exec(release['tag_name'])?.[1] : undefined;
    if (!version || !newer(version, best?.version ?? current)) continue;
    const assets = Array.isArray(release['assets']) ? release['assets'].filter(isObject) : [];
    const url = (a: Record<string, unknown>): string => {
      const u = a['browser_download_url'];
      return typeof u === 'string' && u.startsWith(downloads) ? u : '';
    };
    const exe = assets.find((a) => typeof a['name'] === 'string' && a['name'].endsWith('-portable.exe') && url(a));
    const sha = assets.find((a) => exe && a['name'] === `${String(exe['name'])}.sha256` && url(a));
    if (!exe || !sha || typeof exe['size'] !== 'number') continue;
    best = { version, exeUrl: url(exe), size: exe['size'], shaUrl: url(sha) };
  }
  return best;
}

/** Runs after the pet: retries until the exe is free (the pet has exited), then swaps it in. */
const HELPER = [
  '@echo off',
  'set /a n=0',
  ':try',
  'move /y "%PET_UPDATE_SWAP%" "%PET_UPDATE_EXE%" >nul 2>&1',
  'if not errorlevel 1 goto done',
  'set /a n+=1',
  'if %n% geq 120 goto done',
  'ping -n 2 127.0.0.1 >nul',
  'goto try',
  ':done',
  'if "%PET_UPDATE_RELAUNCH%"=="1" start "" "%PET_UPDATE_EXE%"',
  '',
].join('\r\n');

/** A downloaded, verified update is waiting next to the exe. */
export const pendingUpdate = (exe: string): boolean => existsSync(`${exe}.new`);

/** Removes what an interrupted download or a failed swap left behind. Call once at start. */
export function cleanUpdateLeftovers(exe: string): void {
  for (const ext of ['.download', '.swap']) rmSync(exe + ext, { force: true });
}

/**
 * Starts the helper that replaces `exe` with the waiting update once this pet has exited, and
 * with `relaunch` starts the pet again. The caller must quit right after. Paths reach the helper
 * through environment variables, so they may hold any characters. false = nothing was started.
 */
export function applyUpdate(exe: string, scriptFile: string, relaunch: boolean): boolean {
  try {
    const swap = `${exe}.swap`;
    renameSync(`${exe}.new`, swap);
    writeFileSync(scriptFile, HELPER, 'ascii');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PET_UPDATE_SWAP: swap,
      PET_UPDATE_EXE: exe,
      PET_UPDATE_RELAUNCH: relaunch ? '1' : '0',
    };
    // The next start sets these itself; they describe this run.
    for (const key of Object.keys(env)) if (key.startsWith('PORTABLE_EXECUTABLE')) delete env[key];
    spawn('cmd.exe', ['/d', '/c', scriptFile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: path.dirname(exe),
      env,
    }).unref();
    return true;
  } catch (err) {
    console.warn('[update] could not start the update:', err);
    return false;
  }
}

export interface UpdaterOptions {
  /** Pack id: releases are tagged `<id>-v<version>`. */
  id: string;
  /** Version this pet is running. */
  version: string;
  /** The portable exe to replace. */
  exe: string;
  /** URL of the release list (GitHub API). */
  api: string;
  /** Prefix every asset URL must have. */
  downloads: string;
  /** Called once an update is downloaded, verified and waiting. */
  onReady: (version: string) => void;
}

export class Updater {
  /** Version that is downloaded, verified and waiting in `<exe>.new`; null = none. */
  ready: string | null = null;
  private busy = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly o: UpdaterOptions) {}

  start(): void {
    this.timers.push(
      setTimeout(() => void this.check(), FIRST_CHECK_MS),
      setInterval(() => void this.check(), CHECK_EVERY_MS),
    );
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Looks for a later release and, if there is one, downloads and verifies it. Never throws. */
  async check(): Promise<void> {
    if (this.busy || this.ready) return;
    this.busy = true;
    try {
      const list = await net.fetch(this.o.api, { headers: HEADERS });
      if (!list.ok) throw new Error(`release list: HTTP ${list.status}`);
      const found = pickRelease(await list.json(), this.o.id, this.o.version, this.o.downloads);
      if (!found) {
        console.log(`[update] ${this.o.version} is the latest`);
        return;
      }
      const shaFile = await net.fetch(found.shaUrl, { headers: HEADERS });
      if (!shaFile.ok) throw new Error(`checksum: HTTP ${shaFile.status}`);
      const sha = /\b[a-f0-9]{64}\b/i.exec(await shaFile.text())?.[0]?.toLowerCase();
      if (!sha) throw new Error('the release has no usable checksum');
      console.log(`[update] downloading ${found.version}`);
      await this.download(found, sha);
      this.ready = found.version;
      console.log(`[update] ${found.version} is ready; it is installed when the pet quits`);
      this.o.onReady(found.version);
    } catch (err) {
      console.warn('[update] check failed:', err instanceof Error ? err.message : err);
    } finally {
      this.busy = false;
    }
  }

  private async download(found: ReleaseFile, sha: string): Promise<void> {
    const tmp = `${this.o.exe}.download`;
    const res = await net.fetch(found.exeUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!res.ok || !res.body) throw new Error(`download: HTTP ${res.status}`);
    const hash = createHash('sha256');
    const file = createWriteStream(tmp);
    let failed: Error | undefined;
    file.on('error', (err) => (failed = err)); // e.g. the exe's folder is read-only
    let bytes = 0;
    try {
      for await (const chunk of Readable.fromWeb(res.body as WebStream<Uint8Array>)) {
        if (failed) throw failed;
        const data = chunk as Uint8Array;
        hash.update(data);
        bytes += data.length;
        if (!file.write(data)) await once(file, 'drain');
      }
      file.end();
      await once(file, 'finish');
      if (failed) throw failed;
      if (bytes !== found.size || hash.digest('hex') !== sha) {
        throw new Error('the download does not match the release checksum');
      }
      renameSync(tmp, `${this.o.exe}.new`);
    } catch (err) {
      file.destroy();
      rmSync(tmp, { force: true });
      throw err;
    }
  }
}
