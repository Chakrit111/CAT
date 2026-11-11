# Architecture

## Files

| Path | Role |
| --- | --- |
| `src/main/main.ts` | Windows, 16 ms tick loop, IPC, right-click menu, tray, voice session, sounds, settings, login item |
| `src/main/pet.ts` | Pure state machine + physics (no Electron imports). `pointerDown/Up`, `poke`, `command`, `update` |
| `src/main/prey.ts` | The hunted mouse (pure): wander / flee / escape |
| `src/main/config.ts` | Engine defaults for every tunable number (`DEFAULT_CONFIG`) |
| `src/main/pack.ts` | `loadPack(dir)`: reads `dist/pet/pet.json`, applies `tuning` onto the defaults, checks everything, `PackError` lists all problems |
| `src/main/sprites.ts` | Finds frames, builds alpha masks for hit-testing, manifest of `file://` URLs |
| `src/main/sounds.ts` | `SOUND_NAMES`, finds sound files, `pick(name)` |
| `src/main/commands.ts` | `VoiceCommands(phrases)`: flat phrase list for the worker, `best(scores)` |
| `src/main/voice.ts` | Starts `whisper-worker.js` in a `utilityProcess`, `score(pcm)` |
| `src/main/whisper-worker.ts` | Whisper (transformers.js 4.3.2, pinned: uses internal `_encode_input`) |
| `src/preload.ts`, `src/mouse-preload.ts` | contextBridge APIs (`window.pet`, `window.mouse`) |
| `src/renderer/renderer.ts` | Draws frames, mic badge, records one utterance, plays sounds (`HTMLAudioElement`) |
| `src/renderer/index.html` | CSP: `img-src file:; media-src file:` - extend it for any new asset type |
| `src/renderer/mouse.*` | The mouse, drawn on a canvas in its own click-through window |
| `src/shared/types.ts` | `PET_STATES`, IPC channel names, message types |
| `build.mjs` | esbuild bundles into `dist/`; copies `pets/$PET` (default donut-cat: pet.json, icon.ico, sprites, sounds) to `dist/pet/` |
| `pets/<id>/` | Pet packs. `art/` holds originals and is not copied |
| `scripts/build-pet.mjs` | check-pet, refuse if the exe is running, build with PET=id, electron-builder JS API with the pack's productName/appId/icon/version, output `release/<id>/`; `--run` starts electron instead |
| `scripts/check-pet.mjs` | pack sanity (identity fields, icon 256, numeric RGBA square frames, sounds); exports `checkPet`, `STATES`, `SOUNDS` |
| `scripts/new-pet.mjs` | new pack from donut-cat's pet.json (voice off) or `--from <pack>` |
| `scripts/fit_frames.py`, `contact_sheet.py`, `make_icon.py` | image tools (`npm run import-sprites`, `npm run preview`) |
| `scripts/shortcut.mjs` | `npm run shortcut`: desktop shortcut to the dev build (name and icon from dist/pet) |
| `scripts/meow-synth.mjs` | Synthesised cartoon cat sounds |
| `package.json` `build` | shared electron-builder settings: portable, asar, `onnxruntime-node` and `sharp` unpacked, other-platform onnxruntime builds excluded; identity comes from build-pet |

The main process owns position, state and frame; the renderer only draws what it is told and
reports pointer edges. Hit-testing: each tick main tests the cursor against the frame's alpha mask
and toggles `setIgnoreMouseEvents`.

## States

| State | Kind | fps | Frames now | Notes |
| --- | --- | --- | --- | --- |
| idle | timed 2-5 s | 5 | 4 | required; fallback for missing states |
| walk | timed 3-8 s | 10 | 4 | |
| run | manual | 14 | 4 | the hunt; placeholder frames leaned from walk |
| sit | timed 3-7 s | 2 | 2 | |
| stand | timed 3-7 s | 3 | (idle) | no folder |
| sleep | timed 10-25 s | 3 | 4 | |
| roll | one-shot | 12 | 8 | also after catching the mouse |
| chase | one-shot x3 | 14 | 8 | chasing its donut collar |
| jump | manual, frames follow the arc | - | 6 | frame 0 = crouch; also the pounce; placeholder |
| drag | manual | 4 | 4 | centre, right, centre, left (from art/drag) |
| fall | manual | 8 | 4 | upright, right, upright, left (from art/fall); the pet also starts in fall |

`idleNext` weights: walk 5, sit 2, stand 2, sleep 1, roll 1, chase 1, jump 1, run 1.

`run` has two modes (`config.runMode`, set per pack under `tuning`): `hunt` (the mouse, prey.ts)
and `wheel` (pets/hamster): the pet stays put for `wheel.minMs`-`maxMs`, `FrameMessage.wheel` tells
the renderer to draw a turning wheel (own requestAnimationFrame loop) and the frame `wheel.scale`
times smaller inside it; main's `spritePoint` maps the cursor through the same
`src/shared/wheel.ts` geometry for hit-testing. Which wheel the renderer draws, in this order:
1. `wheel-enter/<n>.png` (manifest `wheelEnter`): at the start of each run, the pet alone over
   `wheel/0.png`, 220 ms a frame, once; the sprite is not drawn meanwhile.
2. `wheel.hub` `[x, y, r]` set: `wheel/0.png` plus that circle of it rotated (flat, front-on wheels
   only; a wheel drawn at an angle looks tilted this way).
3. Pack pictures without `hub`: `wheel/<n>.png` loop, 50 ms a frame (`WHEEL_STEP_MS`). pets/hamster
   uses this; `scripts/wheel_rungs.py` makes the frames by moving only the rungs between the
   opening ellipse and the back-plate ellipse.
4. No pictures: `drawWheel` draws one in code.
Then the sprite, clipped to the ellipse `wheel.opening` `[x, y, rx, ry]` when set, so the rim hides
what sticks out. With `flip` the whole canvas is mirrored, wheel included. pets/hamster's run
frames are already placed inside the opening (`scripts/fit_in_wheel.py`), so its `wheel` has
`scale: 1`, `floor: 1`, `centerX: 0.5`.

Updates (`update.ts`, Windows portable exe only, pack needs `update.repo`): `Updater.check()` reads
the GitHub release list, `pickRelease` takes the latest `<id>-v<x.y.z>` later than `pack.version`
whose assets are on the repo's own download path, the exe is streamed to `<exe>.download`, checked
(size + SHA-256 from `<exe name>.sha256`) and renamed `<exe>.new`. A running portable exe cannot be
renamed (EBUSY), so `applyUpdate` renames `.new` to `.swap` and starts a detached `cmd` helper
(`%TEMP%\<packageName>-update.cmd`, paths passed in env vars) that retries `move` until the exe is
free, then optionally starts it. Called from: `will-quit`, the menu item "Restart to update (v)",
and `start()` when `.new` is found at launch. `<exe>` is `PORTABLE_EXECUTABLE_FILE`.

Click = poke (wake, else roll or chase). Press held > 250 ms or moved > 4 px = drag. Release a
drag = fall. Commandable states: everything except drag and fall.

## Sounds (who plays what)

| Sound | When | Where in main.ts |
| --- | --- | --- |
| meow | voice command understood | voice handler, after `closeVoice()` |
| question | not understood / nothing heard / timeout / error (menu opens) | voice handler, voice timer |
| mew | click (pointer-up with a press and no drag) | `IPC.pointerUp` handler |
| purr | picked up (state -> drag); 1.5 s after falling asleep (`purrDelayMs`) | `onStateChange`, tick |
| happy | let go (state -> fall); pounce caught the mouse (jump -> roll) | `onStateChange` |
| meow / mew / purr | `chatter` every 4-6 min (`chatterMs`); purr if asleep; skipped in drag/fall/jump/run | tick |
| annoyed | not used now | - |

`play()` is silent when Sounds is off, the pet is hidden, or a voice session is open (the cat must
not hear itself). The renderer plays one sound at a time; a new one cuts the old. The pet window
has `autoplayPolicy: 'no-user-gesture-required'`.

## Voice

Right-click -> main sends `voiceListen` -> renderer shows the mic badge, records (VAD: threshold
`max(0.006, noise*4)`, min speech 120 ms, ends after 700 ms quiet, max 5 s; Chromium echo
cancellation / noise suppression / AGC off) -> 16 kHz PCM over IPC -> worker scores all phrases ->
`bestCommand` -> command if score >= -2, else menu with "Not sure I heard that. Closest: ...".
A second right-click during listening skips to the menu. Model cached in
`%APPDATA%\desktop-pet\models` (~240 MB, downloaded on first run). Log lines: `[voice] heard ...`,
`[voice] unsure, closest was ...`, `[voice] nothing heard`.

## Settings, login item, single instance

- userData is set from the pack before the single-instance lock: `%APPDATA%\<packageName>`
  (donut-cat: `desktop-pet`). The speech model cache is always `%APPDATA%\desktop-pet\models`
  (shared by every pack).
- `%APPDATA%\<packageName>\settings.json`: `{ "sounds": true|false }`, written when toggled.
- Start with Windows: `app.setLoginItemSettings` with the path from `loginItem()`. The portable exe
  runs from a new temp folder each time, so it registers `PORTABLE_EXECUTABLE_FILE` (set by
  electron-builder's launcher). Registry: `HKCU\...\CurrentVersion\Run`, value
  `electron.app.Desktop Pet` -> `"...\release\donut-cat\Desktop-Pet-0.1.0-portable.exe"`. The dev
  build registers `electron.exe "<repo>"` separately.
- Dev and exe of the same pack share userData, so they share the single-instance lock: starting one
  while the other runs just unhides the running pet and exits. Different packs run side by side.
- Tray: click = hide/show; menu Hide/Show, Sounds, Start with Windows, Quit. Tray icon only on
  Windows (`.ico`).
