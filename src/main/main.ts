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
import path from 'node:path';
import {
  IPC,
  type FrameMessage,
  type MouseMessage,
  type VoiceListenRequest,
} from '../shared/types';
import { bestCommand, VOICE_PHRASES } from './commands';
import { CONFIG } from './config';
import { Pet, type CommandableState } from './pet';
import { loadSprites } from './sprites';
import { Voice } from './voice';

const TICK_MS = 16;
/** Cap per-tick dt so a suspended laptop or a stalled event loop cannot teleport the pet. */
const MAX_DT_MS = 100;
const READY_TIMEOUT_MS = 10_000;
/** How long past the listening window the renderer may take to hand over its recording. */
const VOICE_GRACE_MS = 4_000;
/** Recordings are 16 kHz mono. Outside 0.2 s - 15 s there is nothing worth transcribing. */
const VOICE_MIN_SAMPLES = 16_000 * 0.2;
const VOICE_MAX_SAMPLES = 16_000 * 15;
/** Tray icon, relative to the app folder. Electron can only read .ico on Windows. */
const TRAY_ICON = 'assets/icon.ico';

function fail(message: string, err?: unknown): void {
  console.error(`[desktop-pet] ${message}`, err ?? '');
  dialog.showErrorBox('Desktop Pet', err instanceof Error ? `${message}\n\n${err.message}` : message);
  app.exit(1);
}

function createPet(): void {
  const { size } = CONFIG;
  const sprites = loadSprites(
    path.join(app.getAppPath(), CONFIG.sprites),
    size,
    CONFIG.alphaThreshold,
  );

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
    },
  });
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

  const voice = new Voice(path.join(__dirname, 'whisper-worker.js'), {
    model: CONFIG.voice.model,
    language: CONFIG.voice.language,
    phrases: VOICE_PHRASES,
    cacheDir: path.join(app.getPath('userData'), 'models'),
  });

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

  const tick = (): void => {
    if (win.isDestroyed() || hidden) return;
    const now = performance.now();
    const dt = Math.min(now - last, MAX_DT_MS);
    last = now;

    const cursor = screen.getCursorScreenPoint();
    pet.update(dt, area, cursor);

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
    const key = `${pet.state}:${pet.frame}:${flip}`;
    if (key !== sentKey) {
      const msg: FrameMessage = { state: pet.state, frame: pet.frame, flip };
      win.webContents.send(IPC.frame, msg);
      sentKey = key;
    }

    const hit =
      pet.pointerHeld || sprites.isOpaque(pet.state, pet.frame, flip, cursor.x - x, cursor.y - y);
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
    return sprites.manifest;
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
    // After a drag the pet may have been dropped on another display.
    if (fromPet(event) && pet.pointerUp()) refreshArea();
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
    if (voice.status !== 'ready') notes.push({ label: voice.label, enabled: false });
    if (notes.length > 0) notes.push({ type: 'separator' });

    menu = Menu.buildFromTemplate([
      ...notes,
      command('Walk', 'walk'),
      command('Sit', 'sit'),
      command('Stand', 'stand'),
      command('Sleep', 'sleep'),
      command('Roll over', 'roll'),
      command('Jump', 'jump'),
      command('Chase the donut', 'chase'),
      command('Chase the mouse', 'run'),
      { type: 'separator' },
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
      showMenu(true);
    }, CONFIG.voice.maxMs + VOICE_GRACE_MS);
  };

  ipcMain.on(IPC.contextMenu, (event) => {
    if (!fromPet(event)) return;
    if (voiceSession !== 0) {
      closeVoice(); // right-click again to skip straight to the menu
      showMenu();
    } else if (voice.status === 'ready') {
      openVoice();
    } else {
      showMenu();
    }
  });

  ipcMain.on(IPC.voiceAudio, (event, pcm: unknown, error: unknown) => {
    if (!fromPet(event) || voiceSession === 0) return;
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
      showMenu(true);
      return;
    }

    voice
      .score(pcm)
      .then((scores) => {
        if (voiceSession !== session) return; // cancelled while the worker was busy
        const guess = bestCommand(scores);
        const clear = guess.score >= CONFIG.voice.minScore;
        console.log(
          `[voice] ${clear ? 'heard' : 'unsure, closest was'} "${guess.phrase}" -> ${guess.command} ` +
            `(score ${guess.score.toFixed(2)}, ${(pcm.length / 16_000).toFixed(1)} s of audio)`,
        );
        closeVoice();
        if (clear) pet.command(guess.command);
        else showMenu(true, guess.phrase);
      })
      .catch((err: unknown) => {
        console.error('[voice] recognition failed:', err);
        if (voiceSession !== session) return;
        closeVoice();
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
      win.hide();
      if (!mouseWin.isDestroyed()) mouseWin.hide();
      mouseShown = false;
    } else if (timer) {
      // Without a timer the renderer is not ready yet, and IPC.ready will show the window.
      last = performance.now();
      win.showInactive();
    }
    tray?.setContextMenu(trayMenu());
  };

  const trayMenu = (): Menu =>
    Menu.buildFromTemplate([
      { label: hidden ? 'Show' : 'Hide', click: () => setHidden(!hidden) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);

  const unhide = (): void => setHidden(false);
  app.on('second-instance', unhide);

  const trayIcon = nativeImage.createFromPath(path.join(app.getAppPath(), TRAY_ICON));
  if (trayIcon.isEmpty()) {
    console.warn(`[desktop-pet] could not read ${TRAY_ICON}; running without a tray icon`);
  } else {
    tray = new Tray(trayIcon);
    tray.setToolTip('Desktop Pet');
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
    voice.dispose();
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(() => {
      if (process.platform === 'darwin') app.dock?.hide();
      createPet();
    })
    .catch((err: unknown) => fail('Failed to start.', err));
}
