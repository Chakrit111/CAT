# Desktop Pet

Transparent, always-on-top desktop pet. Electron + TypeScript (strict).
It wanders along the taskbar, hunts a mouse, and takes spoken commands in Thai.

## Run

```bash
npm install
npm start          # build + launch
npm run typecheck  # tsc --noEmit
npm run shortcut   # Windows: build + put a "Desktop Pet" shortcut on the desktop
```

Requires Node 22.12+ (Electron 45). Quit from the right-click menu on the pet or from the tray icon.

After `npm install`, `npm run shortcut` once gives you a desktop shortcut that starts the pet
without a terminal. The shortcut runs the last build and points at this folder, so run
`npm run shortcut` again after changing code or moving the folder. Opening it while the pet is
already running brings a hidden pet back instead of starting a second one.

The first launch downloads the speech model (about 240 MB) into `%APPDATA%\desktop-pet\models`;
later launches load it from there in a few seconds. Voice also needs Windows to let desktop apps
use the microphone (Settings → Privacy & security → Microphone).

## Controls

| Action | Result |
| --- | --- |
| Click | Wakes it if asleep, otherwise rolls or chases the donut |
| Drag | Pick it up; it falls back to the floor when released (works across displays) |
| Right-click | Listens for a spoken command. Opens the menu instead if nothing clear was said, on a second right-click, or while the speech model is still loading |
| Menu | Walk / Sit / Stand / Sleep / Roll over / Jump / Chase the donut / Chase the mouse / Quit |
| Tray icon (Windows) | Click hides or shows the pet. Right-click for Hide / Show and Quit. New tray icons start under the `^` of hidden icons; drag it onto the taskbar to keep it in view |

Transparent pixels are click-through; only the cat itself receives the mouse.

## Voice commands

Right-click the cat, wait for the red mic badge above it, and say one of these phrases.
Listening stops 0.7 s after you finish (5 s at most) and recognition takes about 2.5 s more.

| Command | Phrases |
| --- | --- |
| Chase the mouse | ไล่หนู, จับหนู, วิ่งไล่หนู, ไปจับหนู, ล่าหนู, หนู, วิ่ง |
| Jump | กระโดด, โดด |
| Stand | ยืน, ยืนขึ้น, ลุก, ลุกขึ้น |
| Sit | นั่ง, นั่งลง |
| Sleep | นอน, ไปนอน, นอนหลับ, หลับ |
| Walk | เดิน, ไปเดิน, เดินเล่น |
| Roll over | กลิ้ง, กลิ้งตัว, ม้วนตัว |
| Chase the donut | โดนัท, ไล่โดนัท, หมุน, หมุนตัว, ไล่หาง |
| Wake up / stop | ตื่น, ตื่นได้แล้ว, หยุด |

Recognition is closed-set. Whisper (`onnx-community/whisper-small`, run locally in a utility
process) does not transcribe what you said; it scores every phrase above against the recording
and the best fit wins. Free transcription of one-word Thai commands was wrong most of the time
with a model this size. The consequence is that only these phrases can be heard: add your own
in `src/main/commands.ts`.

Every attempt is logged to the terminal, for example
`[voice] heard "นั่ง" -> sit (score -0.55, 1.9 s of audio)`. The score is the average
log-probability per token (0 = certain). Below `voice.minScore` in `src/main/config.ts` (-2)
the menu opens instead of the command running. Raise it if stray speech sets the cat off,
lower it if real commands are turned away.

## The mouse

The `run` state is a hunt. A mouse peeks in from the screen edge farther from the cat and
wanders about; the cat runs at it and pounces when close. A pounce that lands on the mouse
catches it and the cat rolls over. A mouse that reaches the screen edge gets away and the cat
sits down, as it does if it has not caught anything after 25 s. Each mouse flees at its own
speed, so the quick ones usually make it out.

Hunts start on command, from the menu, and now and then on their own. The mouse is drawn in
code (`src/renderer/mouse.ts`) in its own click-through window.

## Sprites

Frames live in `assets/sprites-3d/sprites/<state>/<n>.png` and play in numeric file-name order.
The folder is the `sprites` setting in `src/main/config.ts`. A state with no folder falls back
to `idle`.

In the shipped set, `run` and `jump` are **placeholders** made by leaning and stretching frames
of `walk`, `fall` and `idle`. `stand` has no folder, because `idle` already stands on four legs.

| State | Type | Suggested frames | Notes |
| --- | --- | --- | --- |
| `idle` | loop | 4-6 | Required. Breathing / blinking |
| `walk` | loop | 6-8 | Must loop seamlessly |
| `run` | loop | 6-8 | Chasing the mouse. Must loop seamlessly |
| `sit` | loop | 2-4 | |
| `stand` | loop | 2-4 | |
| `sleep` | loop | 2-4 | |
| `roll` | one-shot | 8-12 | Start and end on the idle pose |
| `chase` | one-shot (x3) | 8-12 | Chasing its own collar |
| `jump` | follows the arc | 4-8 | Frame 0 is the crouch before take-off; the others are spread over the flight, from take-off to landing |
| `drag` | loop | 2-4 | Held by the scruff, dangling |
| `fall` | loop | 2 | |

Frame requirements:

- Square PNG with a real alpha channel, 320x320 (2x the 160 px window).
- Same canvas and same character scale in every frame of every state.
- Feet on the bottom edge of the canvas, so the pet stands on the taskbar line.
- Character faces **right**; the app mirrors it when moving left.
- No baked-in ground shadow or background.

## Tuning

`src/main/config.ts`: sprite folder, window size, walk speed, gravity, per-state fps and
durations, the weights for what the pet does after idling, jump height, the hunt (speeds,
ranges, time limit) and voice (model, language, listening time, `minScore`).

## Layout

```
src/main/main.ts            windows, tick loop, IPC, menu, tray icon, voice session
src/main/pet.ts             state machine + physics (pure, no Electron imports)
src/main/prey.ts            the hunted mouse (pure)
src/main/sprites.ts         sprite discovery + alpha masks for hit-testing
src/main/commands.ts        voice phrases and picking the best fit
src/main/voice.ts           starts the speech worker and talks to it
src/main/whisper-worker.ts  Whisper, in a utility process
src/main/config.ts          tuning
src/preload.ts              contextBridge API for the pet window
src/mouse-preload.ts        contextBridge API for the mouse window
src/renderer/               pet canvas, mic badge and recording; mouse canvas
src/shared/types.ts         IPC contract
scripts/shortcut.mjs        makes the Windows desktop shortcut (npm run shortcut)
assets/icon.ico             tray and shortcut icon
```

The main process owns position, state and frame index. Each tick it polls the cursor,
tests it against the current frame's alpha mask and toggles `setIgnoreMouseEvents`,
so no mouse-forwarding is needed and the renderer only draws what it is told.

The one other job the pet's renderer has is the microphone: main asks it for one utterance,
gets 16 kHz samples back and hands them to the speech worker, so the model never blocks the
tick loop.

## Known limits

- Native Wayland: Electron cannot read the global cursor or position windows there. Use X11 / XWayland.
- The tray icon and `npm run shortcut` are Windows only (Electron reads `.ico` files only on
  Windows). Elsewhere the pet runs without a tray icon; quit it from its own right-click menu.
- Voice is Thai only and hears only the phrases listed above.
- Voice has been measured with synthetic speech only (the Windows Thai voice, played through
  Chromium's fake microphone): 11 of 12 commands came out right, and "ตื่น" was heard as "เดิน".
- The speech worker calls `_encode_input`, a method internal to transformers.js, so
  `@huggingface/transformers` is pinned to 4.3.2.
- No packaging config yet (electron-builder / Forge) and no auto-start. A packaged build has to
  leave `@huggingface/transformers` and its native addons outside the asar archive.
