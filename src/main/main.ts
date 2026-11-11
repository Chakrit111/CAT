import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle,
} from 'electron';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  IPC,
  type FrameMessage,
  type MouseMessage,
  type PetState,
  type SoundMessage,
  type VoiceListenRequest,
} from '../shared/types';
import { VoiceCommands } from './commands';
import { loadPack, PackError, type PetPack } from './pack';
import { Pet, type CommandableState } from './pet';
import { Sounds, type SoundName } from './sounds';
import { loadSprites } from './sprites';
import { Voice } from './voice';
import { wheelGeometry } from '../shared/wheel';

const TICK_MS = 16;
/** Cap per-tick dt so a suspended laptop or a stalled event loop cannot teleport the pet. */
const MAX_DT_MS = 100;
const READY_TIMEOUT_MS = 10_000;
/** How long past the listening window the renderer may take to hand over its recording. */
const VOICE_GRACE_MS = 4_000;
/** Recordings are 16 kHz mono. Outside 0.2 s - 15 s there is nothing worth transcribing. */
const VOICE_MIN_SAMPLES = 16_000 * 0.2;
const VOICE_MAX_SAMPLES = 16_000 * 15;
/** build.mjs copies the selected pet pack (pets/<id>/) here. */
const PACK_DIR = path.join(__dirname, 'pet');
/** The speech model is the engine's, not a pet's: every pet shares one download. */
const MODEL_CACHE = (): string => path.join(app.getPath('appData'), 'desktop-pet', 'models');
/** Title for error dialogs; the pack's product name once it is loaded. */
let appTitle = 'Desktop Pet';

/** What the user can switch from the menus, kept in `<userData>/settings.json` between runs. */
interface Settings {
  sounds: boolean;
}

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  try {
    const saved: unknown = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    if (typeof saved === 'object' && saved !== null && 'sounds' in saved && typeof saved.sounds === 'boolean') {
      return { sounds: saved.sounds };
    }
  } catch {
    // First run, or the file is unreadable: use the defaults.
  }
  return { sounds: true };
}

function saveSettings(settings: Settings): void {
  try {
    writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('[desktop-pet] could not save settings:', err);
  }
}

/**
 * What Windows runs at login to start this copy of the pet. The portable exe unpacks itself to a
 * new temp folder on every start, so it is registered by its own path (electron-builder passes it
 * in PORTABLE_EXECUTABLE_FILE), not by the unpacked copy that is running. In development it is
 * electron.exe with the project folder.
 */
function loginItem(): { path: string; args: string[] } {
  const portable = process.env['PORTABLE_EXECUTABLE_FILE'];
  if (portable) return { path: portable, args: [] };
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}

/** Login items exist on Windows and macOS only. */
const LOGIN_ITEMS = process.platform === 'win32' || process.platform === 'darwin';

/**
 * For tuning voice commands: with PET_VOICE_LOG_DIR set, every recording is kept there as a 16 kHz
 * WAV with its result in voice-log.jsonl, so thresholds and phrases can be judged on real voices.
 * Off unless the variable is set; nothing is recorded in normal use.
 */
function saveVoiceSample(pcm: Float32Array, result: object): void {
  const dir = process.env['PET_VOICE_LOG_DIR'];
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    const data = Buffer.alloc(44 + pcm.length * 2);
    data.write('RIFF', 0);
    data.writeUInt32LE(36 + pcm.length * 2, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(16_000, 24);
    data.writeUInt32LE(32_000, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(pcm.length * 2, 40);
    pcm.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
    writeFileSync(path.join(dir, name), data);
    appendFileSync(path.join(dir, 'voice-log.jsonl'), `${JSON.stringify({ file: name, ...result })}\n`);
  } catch (err) {
    console.warn('[voice] could not save the recording:', err);
  }
}

function fail(message: string, err?: unknown): void {
  console.error(`[desktop-pet] ${message}`, err ?? '');
  dialog.showErrorBox(appTitle, err instanceof Error ? `${message}\n\n${err.message}` : message);
  app.exit(1);
}

function createPet(pack: PetPack): void {
  const CONFIG = pack.config;
  const { size } = CONFIG;
  const sprites = loadSprites(path.join(pack.dir, 'sprites'), size, CONFIG.alphaThreshold);
  const sounds = new Sounds(path.join(pack.dir, 'sounds'));
  const settings = loadSettings();

  let area: Rectangle = screen.getPrimaryDisplay().workArea;
  // Spawn at the top of the screen and drop in.
  const pet = new Pet(CONFIG, sprites.frameCounts, {
    x: area.x + Math.random() * Math.max(0, area.width - size),
    y: area.y,
  });

  const win = new BrowserWindow({
    x: Math.round(pet.x),
    y: Math.round(pet.y),
    width: size,
    height: size,
    title: pack.productName,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The cat meows on its own (purring when it falls asleep), not only right after a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.on('page-title-updated', (event) => event.preventDefault()); // keep the pack's name, not index.html's
  win.setVisibleOnAllWorkspaces(true);
  // Click-through by default; the tick loop turns it off only while the cursor is over the cat.
  win.setIgnoreMouseEvents(true);

  // The mouse the cat hunts has its own small window: always click-through, shown only during a hunt.
  const mouseSize = CONFIG.hunt.mouseSize;
  const mouseWin = new BrowserWindow({
    width: mouseSize,
    height: mouseSize,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'mouse-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mouseWin.setVisibleOnAllWorkspaces(true);
  mouseWin.setIgnoreMouseEvents(true);
  let mouseLoaded = false;
  mouseWin.webContents.once('did-finish-load', () => {
    mouseLoaded = true;
  });

  // The one permission this app uses: the pet window may record audio for voice commands.
  const permissions = win.webContents.session;
  permissions.setPermissionRequestHandler((contents, permission, callback, details) => {
    const audioOnly =
      permission === 'media' &&
      'mediaTypes' in details &&
      details.mediaTypes?.every((type) => type === 'audio') === true;
    callback(contents === win.webContents && audioOnly);
  });
  permissions.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      contents === win.webContents && permission === 'media' && details.mediaType !== 'video',
  );

  // Packs without voice never start the speech worker (or download its 240 MB model).
  const commands = new VoiceCommands(pack.phrases);
  const voice =
    pack.features.voice && commands.phrases.length > 0
      ? new Voice(path.join(__dirname, 'whisper-worker.js'), {
          model: CONFIG.voice.model,
          language: CONFIG.voice.language,
          phrases: commands.phrases,
          cacheDir: MODEL_CACHE(),
        })
      : null;

  const fromPet = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.sender === win.webContents;

  const refreshArea = (): void => {
    if (!win.isDestroyed()) area = screen.getDisplayMatching(win.getBounds()).workArea;
  };

  // --- main loop -----------------------------------------------------------
  let timer: NodeJS.Timeout | undefined;
  let last = 0;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let sentKey = '';
  let interactive = false;
  let mouseShown = false;
  let mouseKey = '';
  /** Set from the tray: the windows are hidden and the pet stands still until it is shown again. */
  let hidden = false;
  let lastState: PetState = pet.state;

  // --- sounds --------------------------------------------------------------
  let purrAt = Number.POSITIVE_INFINITY;

  const sendSound = (msg: SoundMessage): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.sound, msg);
  };

  /** The cat has one voice: a new sound cuts off the one playing. */
  const play = (name: SoundName): void => {
    // Never while hidden, and never into the microphone during a voice command.
    if (!pack.features.sounds || !settings.sounds || hidden || voiceSession !== 0) return;
    const url = sounds.pick(name);
    if (url) sendSound({ url, volume: CONFIG.sounds.volume });
  };

  const hush = (): void => sendSound({ url: null, volume: 0 });

  const setSoundsOn = (on: boolean): void => {
    settings.sounds = on;
    saveSettings(settings);
    if (!on) hush();
    tray?.setContextMenu(trayMenu());
  };

  const soundsItems = (): MenuItemConstructorOptions[] =>
    pack.features.sounds
      ? [{ label: 'Sounds', type: 'checkbox', checked: settings.sounds, click: (item) => setSoundsOn(item.checked) }]
      : [];

  /** "Start with Windows": read from and written to the system's login items, so it is never out of date. */
  const startupItems = (): MenuItemConstructorOptions[] =>
    LOGIN_ITEMS
      ? [
          {
            label: process.platform === 'win32' ? 'Start with Windows' : 'Open at login',
            type: 'checkbox',
            checked: app.getLoginItemSettings(loginItem()).openAtLogin,
            click: (item) => {
              app.setLoginItemSettings({ openAtLogin: item.checked, ...loginItem() });
              tray?.setContextMenu(trayMenu());
            },
          },
        ]
      : [];

  const nextChatter = (): number => {
    const { min, max } = CONFIG.sounds.chatterMs;
    return performance.now() + min + Math.random() * (max - min);
  };
  let chatterAt = nextChatter();

  /** The occasional unprompted sound: a purr while asleep, a meow otherwise, nothing while busy. */
  const chatter = (): void => {
    const state = pet.state;
    if (state === 'sleep') play('purr');
    else if (state !== 'drag' && state !== 'fall' && state !== 'jump' && state !== 'run') {
      play(Math.random() < 0.5 ? 'meow' : 'mew');
    }
  };

  /** Sounds that come from what the cat does by itself; the ones answering the user are played where they happen. */
  const onStateChange = (prev: PetState, next: PetState): void => {
    purrAt = next === 'sleep' ? performance.now() + CONFIG.sounds.purrDelayMs : Number.POSITIVE_INFINITY;
    if (next === 'drag') play('purr'); // picked up
    // Let go after a drag. The drop at start-up does not count: the pet starts out falling.
    else if (next === 'fall') play('happy');
    // Jump to roll only happens when a pounce lands on the mouse (clicks are ignored mid-air).
    else if (prev === 'jump' && next === 'roll') play('happy');
  };

  /** A point in the window -> the same point on the pet's frame, which is drawn smaller inside the wheel. */
  const spritePoint = (wx: number, wy: number): [number, number] => {
    if (!pet.inWheel) return [wx, wy];
    const { scale, floor, centerX } = CONFIG.wheel;
    const g = wheelGeometry(size, scale, floor, centerX);
    return [(wx - g.spriteX) / scale, (wy - g.spriteY) / scale];
  };

  const tick = (): void => {
    if (win.isDestroyed() || hidden) return;
    const now = performance.now();
    const dt = Math.min(now - last, MAX_DT_MS);
    last = now;

    const cursor = screen.getCursorScreenPoint();
    pet.update(dt, area, cursor);

    if (pet.state !== lastState) {
      onStateChange(lastState, pet.state);
      lastState = pet.state;
    }
    if (pet.state === 'sleep' && now >= purrAt) {
      purrAt = Number.POSITIVE_INFINITY;
      play('purr');
    }
    if (now >= chatterAt) {
      chatterAt = nextChatter();
      chatter();
    }

    const x = Math.round(pet.x);
    const y = Math.round(pet.y);
    if (x !== lastX || y !== lastY) {
      // setBounds (not setPosition): re-asserting the size keeps the window from
      // drifting larger on fractionally scaled displays.
      win.setBounds({ x, y, width: size, height: size });
      lastX = x;
      lastY = y;
    }

    const flip = pet.facing === -1;
    const { scale, turnsPerSecond, floor, centerX, hub, opening } = CONFIG.wheel;
    const wheel = pet.inWheel ? { scale, turnsPerSecond, floor, centerX, hub, opening } : undefined;
    const key = `${pet.state}:${pet.frame}:${flip}:${wheel ? 'wheel' : ''}`;
    if (key !== sentKey) {
      const msg: FrameMessage = { state: pet.state, frame: pet.frame, flip, wheel };
      win.webContents.send(IPC.frame, msg);
      sentKey = key;
    }

    const hit =
      pet.pointerHeld || sprites.isOpaque(pet.state, pet.frame, flip, ...spritePoint(cursor.x - x, cursor.y - y));
    if (hit !== interactive) {
      win.setIgnoreMouseEvents(!hit);
      interactive = hit;
    }

    if (mouseWin.isDestroyed()) return;
    const prey = pet.prey;
    if (!prey) {
      if (mouseShown) {
        mouseWin.hide();
        mouseShown = false;
      }
      return;
    }
    mouseWin.setBounds({
      x: Math.round(prey.x),
      y: Math.round(prey.y),
      width: mouseSize,
      height: mouseSize,
    });
    const mouseFlip = prey.facing === -1;
    const mouseState = `${mouseFlip}:${prey.moving}`;
    if (mouseLoaded && mouseState !== mouseKey) {
      const msg: MouseMessage = { flip: mouseFlip, moving: prey.moving };
      mouseWin.webContents.send(IPC.mouseState, msg);
      mouseKey = mouseState;
    }
    if (!mouseShown) {
      mouseWin.showInactive();
      mouseShown = true;
    }
  };

  const readyTimeout = setTimeout(() => {
    fail('Renderer did not become ready. Run `npm run build` and check the sprite files.');
  }, READY_TIMEOUT_MS);

  // --- IPC -----------------------------------------------------------------
  ipcMain.handle(IPC.manifest, (event) => {
    if (!fromPet(event)) throw new Error('Unexpected sender');
    // A pack may bring its own wheel pictures; without them the renderer draws a wheel.
    const wheelDir = path.join(pack.dir, 'wheel');
    const files = existsSync(wheelDir)
      ? readdirSync(wheelDir)
          .filter((f) => /^\d+\.png$/i.test(f))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((f) => path.join(wheelDir, f))
      : existsSync(path.join(pack.dir, 'wheel.png'))
        ? [path.join(pack.dir, 'wheel.png')]
        : [];
    const enterDir = path.join(pack.dir, 'wheel-enter');
    const enter = existsSync(enterDir)
      ? readdirSync(enterDir)
          .filter((f) => /^\d+\.png$/i.test(f))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((f) => pathToFileURL(path.join(enterDir, f)).href)
      : [];
    return {
      ...sprites.manifest,
      ...(files.length ? { wheel: files.map((f) => pathToFileURL(f).href) } : {}),
      ...(enter.length ? { wheelEnter: enter } : {}),
    };
  });

  ipcMain.on(IPC.ready, (event) => {
    if (!fromPet(event) || timer) return;
    clearTimeout(readyTimeout);
    if (!hidden) win.showInactive();
    last = performance.now();
    timer = setInterval(tick, TICK_MS);
  });

  ipcMain.on(IPC.pointerDown, (event) => {
    if (fromPet(event)) pet.pointerDown(screen.getCursorScreenPoint());
  });

  ipcMain.on(IPC.pointerUp, (event) => {
    if (!fromPet(event)) return;
    const pressed = pet.pointerHeld; // pointer-up also arrives on blur, with no press behind it
    // After a drag the pet may have been dropped on another display.
    if (pet.pointerUp()) refreshArea();
    else if (pressed) play('mew'); // it was a click
  });

  const command = (label: string, state: CommandableState): MenuItemConstructorOptions => ({
    label,
    click: () => pet.command(state),
  });
  let menu: Menu | undefined; // held here so the open menu stays referenced
  /**
   * @param afterVoice the menu follows a voice attempt instead of a right-click
   * @param closest    the likeliest phrase, when the recording was too unclear to act on
   */
  const showMenu = (afterVoice = false, closest?: string): void => {
    const notes: MenuItemConstructorOptions[] = [];
    if (closest !== undefined) {
      notes.push({ label: `Not sure I heard that. Closest: "${closest}"`, enabled: false });
    }
    if (voice && voice.status !== 'ready') notes.push({ label: voice.label, enabled: false });
    if (notes.length > 0) notes.push({ type: 'separator' });

    menu = Menu.buildFromTemplate([
      ...notes,
      ...pack.menu.map(([state, label]) => command(label, state)),
      { type: 'separator' },
      ...soundsItems(),
      ...startupItems(),
      { label: 'Quit', click: () => app.quit() },
    ]);
    // By the time a voice attempt ends the cursor may be elsewhere, so that menu opens on the cat.
    const half = Math.round(size / 2);
    menu.popup(afterVoice ? { window: win, x: half, y: half } : { window: win });
  };

  // --- voice ---------------------------------------------------------------
  // A right-click opens a voice session: the renderer records one utterance, the worker scores
  // it against the known phrases and a clear enough command is carried out. Everything else
  // (silence, an unclear recording, an error, a second right-click, the model still loading)
  // ends in the menu.
  let voiceSession = 0; // 0 = no session open
  let voiceSeq = 0;
  let voiceTimer: NodeJS.Timeout | undefined;

  const closeVoice = (): void => {
    clearTimeout(voiceTimer);
    voiceSession = 0;
    if (!win.isDestroyed()) win.webContents.send(IPC.voiceEnd);
  };

  const openVoice = (): void => {
    voiceSession = ++voiceSeq;
    const request: VoiceListenRequest = { maxMs: CONFIG.voice.maxMs };
    win.webContents.send(IPC.voiceListen, request);
    voiceTimer = setTimeout(() => {
      closeVoice();
      play('question');
      showMenu(true);
    }, CONFIG.voice.maxMs + VOICE_GRACE_MS);
  };

  ipcMain.on(IPC.contextMenu, (event) => {
    if (!fromPet(event)) return;
    if (voiceSession !== 0) {
      closeVoice(); // right-click again to skip straight to the menu
      showMenu();
    } else if (voice?.status === 'ready') {
      openVoice();
    } else {
      showMenu();
    }
  });

  ipcMain.on(IPC.voiceAudio, (event, pcm: unknown, error: unknown) => {
    if (!voice || !fromPet(event) || voiceSession === 0) return;
    const session = voiceSession;
    clearTimeout(voiceTimer);

    if (typeof error === 'string') console.warn(`[voice] microphone: ${error}`);
    if (
      !(pcm instanceof Float32Array) ||
      pcm.length < VOICE_MIN_SAMPLES ||
      pcm.length > VOICE_MAX_SAMPLES
    ) {
      console.log('[voice] nothing heard');
      closeVoice();
      play('question');
      showMenu(true);
      return;
    }

    voice
      .score(pcm)
      .then((scores) => {
        if (voiceSession !== session) return; // cancelled while the worker was busy
        const guess = commands.best(scores);
        const clear = guess.score >= CONFIG.voice.minScore;
        const runnerUp = commands.ranked(scores)[1];
        console.log(
          `[voice] ${clear ? 'heard' : 'unsure, closest was'} "${guess.phrase}" -> ${guess.command} ` +
            `(score ${guess.score.toFixed(2)}, ${(pcm.length / 16_000).toFixed(1)} s of audio)` +
            (runnerUp ? `; next "${runnerUp.phrase}" ${runnerUp.score.toFixed(2)}` : ''),
        );
        saveVoiceSample(pcm, { phrase: guess.phrase, command: guess.command, score: guess.score, clear, runnerUp });
        closeVoice(); // first: play() stays silent while a session is open
        if (clear) {
          play('meow');
          pet.command(guess.command);
        } else {
          play('question');
          showMenu(true, guess.phrase);
        }
      })
      .catch((err: unknown) => {
        console.error('[voice] recognition failed:', err);
        if (voiceSession !== session) return;
        closeVoice();
        play('question');
        showMenu(true);
      });
  });

  // --- tray ----------------------------------------------------------------
  // The windows have no taskbar entry, so the tray icon is the way to hide the pet, bring it
  // back, or quit without finding the cat first. Starting the app a second time (the desktop
  // shortcut) also brings a hidden pet back.
  let tray: Tray | undefined;

  const setHidden = (hide: boolean): void => {
    if (hide === hidden || win.isDestroyed()) return;
    hidden = hide;
    if (hide) {
      if (voiceSession !== 0) closeVoice(); // never leave the microphone open behind a hidden pet
      hush();
      win.hide();
      if (!mouseWin.isDestroyed()) mouseWin.hide();
      mouseShown = false;
    } else if (timer) {
      // Without a timer the renderer is not ready yet, and IPC.ready will show the window.
      last = performance.now();
      chatterAt = nextChatter(); // the clock ran on while hidden; no meow the moment it reappears
      win.showInactive();
    }
    tray?.setContextMenu(trayMenu());
  };

  const trayMenu = (): Menu =>
    Menu.buildFromTemplate([
      { label: hidden ? 'Show' : 'Hide', click: () => setHidden(!hidden) },
      ...soundsItems(),
      ...startupItems(),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);

  const unhide = (): void => setHidden(false);
  app.on('second-instance', unhide);

  const iconFile = path.join(pack.dir, 'icon.ico');
  const trayIcon = nativeImage.createFromPath(iconFile);
  if (trayIcon.isEmpty()) {
    console.warn(`[desktop-pet] could not read ${iconFile}; running without a tray icon`);
  } else {
    tray = new Tray(trayIcon);
    tray.setToolTip(pack.productName);
    tray.setContextMenu(trayMenu());
    tray.on('click', () => setHidden(!hidden));
  }

  // --- lifecycle -----------------------------------------------------------
  screen.on('display-metrics-changed', refreshArea);
  screen.on('display-removed', refreshArea);

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(`[renderer] ${event.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    fail(`Renderer process exited (${details.reason}).`);
  });
  win.on('closed', () => {
    clearTimeout(readyTimeout);
    clearTimeout(voiceTimer);
    clearInterval(timer);
    voice?.dispose();
    tray?.destroy();
    app.off('second-instance', unhide);
    if (!mouseWin.isDestroyed()) mouseWin.destroy();
    screen.off('display-metrics-changed', refreshArea);
    screen.off('display-removed', refreshArea);
  });

  win.loadFile(path.join(__dirname, 'index.html')).catch((err: unknown) => {
    fail('Failed to load the renderer.', err);
  });
  // The pet works without its mouse, so a mouse that fails to load is only logged.
  mouseWin.loadFile(path.join(__dirname, 'mouse.html')).catch((err: unknown) => {
    console.error('[desktop-pet] Failed to load the mouse window.', err);
  });
}

function start(): void {
  let pack: PetPack;
  try {
    pack = loadPack(PACK_DIR);
  } catch (err) {
    // A broken pet.json: say exactly what is wrong instead of starting a half-configured pet.
    fail(err instanceof PackError ? 'This pet pack has problems:' : 'Could not load the pet pack.', err);
    return;
  }
  appTitle = pack.productName;
  // One settings folder and one single-instance lock per pet, so two client pets never collide.
  // Must happen before the lock is requested.
  app.setPath('userData', path.join(app.getPath('appData'), pack.packageName));

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(() => {
      if (process.platform === 'darwin') app.dock?.hide();
      createPet(pack);
    })
    .catch((err: unknown) => fail('Failed to start.', err));
}

start();
