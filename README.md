# Desktop Pet

Transparent, always-on-top desktop pet. Electron + TypeScript (strict).
It wanders along the taskbar, hunts a mouse, and takes spoken commands in Thai.

## Run

```bash
npm install
npm start          # build + launch
npm run typecheck  # tsc --noEmit
npm run shortcut   # Windows: build + put a "Desktop Pet" shortcut on the desktop
npm run dist       # Windows: build release/donut-cat/Desktop-Pet-<version>-portable.exe
```

Everything that makes this cat this cat (names, sprites, sounds, icon, menu, voice phrases,
tuning) is a **pet pack** in `pets/donut-cat/`. The rest is an engine that can run any pack; see
[Pets for clients](#pets-for-clients).

Requires Node 22.12+ (Electron 45). Quit from the right-click menu on the pet or from the tray icon.

After `npm install`, `npm run shortcut` once gives you a desktop shortcut that starts the pet
without a terminal. The shortcut runs the last build and points at this folder, so run
`npm run shortcut` again after changing code or moving the folder. Opening it while the pet is
already running brings a hidden pet back instead of starting a second one.

### Portable .exe

`npm run dist` packages the pet with electron-builder into one file,
`release/donut-cat/Desktop-Pet-<version>-portable.exe` (about 140 MB). Close the pet first: a
running copy locks the exe, and the build refuses to start while it runs. It runs on any 64-bit Windows
machine without Node.js or installing anything: double-click it. Each start unpacks the app to a
temporary folder first, so the cat takes about 10 s to appear. The speech model is not inside the
exe; it is downloaded on first use, as above, and shared with `npm start`.

**Start with Windows** in either menu makes Windows start the pet when you sign in. It registers
whichever copy is running: the portable exe at its own path (so keep the exe where it is), or, in
development, `electron.exe` with this folder. Turn it off from the same menu item; it is an
ordinary entry under Settings → Apps → Startup.

The exe is not code-signed, so on another machine Windows SmartScreen may say "Windows protected
your PC"; choose More info → Run anyway. `release/` is not committed: the exe is over GitHub's
100 MB file limit, so share it another way (a GitHub Release, for example).

The first launch downloads the speech model (about 240 MB) into `%APPDATA%\desktop-pet\models`
(shared by every pet that uses voice); later launches load it from there in a few seconds. Voice also needs Windows to let desktop apps
use the microphone (Settings → Privacy & security → Microphone).

## Controls

| Action | Result |
| --- | --- |
| Click | Wakes it if asleep, otherwise rolls or chases the donut |
| Drag | Pick it up; it falls back to the floor when released (works across displays) |
| Right-click | Listens for a spoken command. Opens the menu instead if nothing clear was said, on a second right-click, or while the speech model is still loading |
| Menu | Walk / Sit / Stand / Sleep / Roll over / Jump / Chase the donut / Chase the mouse / Sounds (on/off) / Start with Windows (on/off) / Quit |
| Tray icon (Windows) | Click hides or shows the pet. Right-click for Hide / Show, Sounds, Start with Windows and Quit. New tray icons start under the `^` of hidden icons; drag it onto the taskbar to keep it in view |

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
under `voice.phrases` in `pets/donut-cat/pet.json`.

Every attempt is logged to the terminal, for example
`[voice] heard "นั่ง" -> sit (score -0.55, 1.9 s of audio)`. The score is the average
log-probability per token (0 = certain). Below `voice.minScore` (-2; `tuning.voice.minScore` in pet.json)
the menu opens instead of the command running. Raise it if stray speech sets the cat off,
lower it if real commands are turned away.

## Sounds

The cat meows back. Each sound is a folder in `pets/donut-cat/sounds/`; every time, one file from it
is picked at random (never the same one twice in a row), and a new sound cuts off the one
playing.

| Folder | Played when |
| --- | --- |
| `meow` | A voice command was understood |
| `question` | A voice command was not understood, or nothing was heard (the menu opens) |
| `mew` | You click the cat |
| `happy` | It catches the mouse, or you let go of it and it falls |
| `purr` | You pick it up, or it falls asleep (1.5 s later) |
| `annoyed` | Not played at the moment; kept for later |
| `meow` or `mew`, `purr` if asleep | Now and then on its own, every 4-6 minutes (not while it is busy being dragged, falling, jumping or hunting) |

Turn sounds on or off with **Sounds** in the cat's right-click menu or the tray menu; the choice
is kept in `%APPDATA%\desktop-pet\settings.json`. The cat is always quiet while it listens for a
voice command (so it cannot hear itself) and while hidden.

`scripts/meow-synth.mjs` synthesises cartoon meows (`node scripts/meow-synth.mjs pets/<id>/sounds`
writes a full set; the `annoyed` ones in donut-cat came from it). Any `.wav`, `.mp3` or `.ogg`
files work; a folder left empty is silent. Volume, the purr delay and how often it meows on its
own (`chatterMs`) are `sounds` in `src/main/config.ts`, overridable under `tuning.sounds`.

## The mouse

The `run` state is a hunt. A mouse peeks in from the screen edge farther from the cat and
wanders about; the cat runs at it and pounces when close. A pounce that lands on the mouse
catches it and the cat rolls over. A mouse that reaches the screen edge gets away and the cat
sits down, as it does if it has not caught anything after 25 s. Each mouse flees at its own
speed, so the quick ones usually make it out.

Hunts start on command, from the menu, and now and then on their own. The mouse is drawn in
code (`src/renderer/mouse.ts`) in its own click-through window.

## Sprites

Frames live in `pets/<id>/sprites/<state>/<n>.png` and play in numeric file-name order. A state
with no frames falls back to `idle`. Put original artwork in `pets/<id>/art/<state>/` (not
shipped) and fit it with `npm run import-sprites` (see below).

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

`src/main/config.ts` holds the engine's defaults: sound volume, window size, walk speed, gravity,
per-state fps and durations, the weights for what the pet does after idling, jump height, the
hunt (speeds, ranges, time limit) and voice (model, listening time, `minScore`). A pack changes
any of them under `tuning` in its pet.json, only the keys it needs:

```json
"tuning": { "walkSpeed": 90, "states": { "drag": { "fps": 6 } }, "sounds": { "volume": 0.4 } }
```

A misspelt or wrongly typed key is not ignored: the pet refuses to start and lists every problem.

## Pets for clients

One engine, one folder per pet:

```
pets/<id>/
  pet.json        id, productName (exe and tray name), packageName (settings folder, unique per
                  pet), appId, version, features, menu, voice, tuning
  icon.ico        tray, exe and shortcut icon (needs a 256x256 image)
  sprites/<state>/0.png, 1.png, ...
  sounds/<sound>/*.wav|mp3|ogg
  art/            the client's original artwork (not shipped)
```

`features` switches parts on or off per pet: `voice` (Thai voice commands; adds the 240 MB
speech model on first run; off by default for new pets), `hunt` (the `run` state; off removes it
from the menu and from what the pet does by itself), `sounds`. What `run` is depends on
`tuning.runMode`: `"hunt"` (default) chases a mouse across the screen, `"wheel"` runs in place in a
wheel the app draws around the pet, smaller inside it, for 6-12 s (`tuning.wheel`). `menu` lists the commands shown in the
right-click menu, in order, with their labels. Each pet keeps its own settings in
`%APPDATA%\<packageName>`, so two pets never share settings or block each other.

```bash
npm run new-pet -- acme-cat --name "Acme Cat"     # empty pack (or --from donut-cat to copy one)
npm run import-sprites -- pets/acme-cat/art/idle pets/acme-cat/sprites/idle --scale-by height --anchor bottom --target 220 --preview release
python -I scripts/make_icon.py pets/acme-cat/sprites/idle/0.png pets/acme-cat/icon.ico release/icon.png 100,40,260,200
npm run preview -- pets/acme-cat/sprites release/acme-cat-sprites.png
npm run check-pet -- acme-cat                     # what is missing or wrong
npm run build-pet -- acme-cat --run               # try it (no exe)
npm run build-pet -- acme-cat                     # release/acme-cat/Acme-Cat-1.0.0-portable.exe
```

### Updates

A pet whose pet.json has `"update": { "repo": "owner/name" }` keeps its portable exe up to date
from that GitHub repository's releases. One minute after it starts, and every 6 hours, it looks
for a release tagged `<id>-v<version>` later than its own, downloads the exe next to itself and
checks it against the release's `.sha256`. Windows does not let a running exe be replaced, so the
new one is swapped in when the pet quits (or from **Restart to update** in the menus, or at the
next start if Windows shut down first). The exe keeps its file name, so the shortcut and Start
with Windows still point at it. Without `update` the pet never looks.

```bash
# raise "version" in pets/acme-cat/pet.json first
npm run build-pet -- acme-cat                     # the exe and its .sha256
npm run publish-pet -- acme-cat --notes "what changed"   # gh release create acme-cat-v1.0.1 ...
```

`publish-pet` needs the gh CLI signed in; add `--dry-run` to see the command only. The release is
public at once, and anyone can download the exe from a public repository. The checksum guards
against a broken download, not against someone who can publish to the repository; the exe is not
code-signed. Each update is the whole exe (about 130 MB).

A pack can bring its own wheel, as pets/hamster does (all pictures 320x320, drawn window-sized):

- `wheel.png` or `wheel/<n>.png`: the wheel, drawn behind the pet. Several frames loop, 50 ms each.
  For a wheel drawn at an angle, `python -I scripts/wheel_rungs.py <wheel.png> <pack>/wheel --front
  cx,cy,a,b --back cx,cy,a,b` makes the frames: the picture stays still and only the rungs inside
  move (`--front` is the ellipse of the opening, `--back` of the back plate, in picture pixels).
  For a flat, front-on wheel, set `tuning.wheel.hub` to `[x, y, radius]` (fractions of the window)
  instead and that circle of the one picture is turned.
- `sprites/run/`: for a wheel drawn at an angle, `python -I scripts/fit_in_wheel.py <bottom-anchored
  run frames> <pack>/sprites/run --opening cx,cy,a,b` moves each frame as low as the whole pet
  still fits in the opening, feet on its curve. Then use `tuning.wheel` `scale: 1`, `floor: 1`,
  `centerX: 0.5`. Otherwise `scale` (pet size inside the wheel, 0.3-1), `floor` (feet, fraction
  from the top) and `centerX` place the ordinary frames.
- `tuning.wheel.opening` `[x, y, radiusX, radiusY]` (fractions): the pet is only drawn inside that
  ellipse, so the rim hides anything that still sticks out.
- `wheel-enter/<n>.png`: optional; the pet alone, played once over the wheel (220 ms each) as it
  gets in, before the run. `scripts/climb_frames.py` cut the hamster's from a green sheet drawn
  with the wheel, shrank it to the size of the other poses and fitted it into the opening.

Artwork from AI image tools often comes as JPG with the "transparent" checkerboard painted in.
`python -I scripts/remove_checker.py <picture.jpg> <out dir>` cuts the figures out (and splits a
sheet of several poses into one PNG each); it cannot rescue anything translucent, such as glass or
glow, drawn over the checkerboard. Ask for a plain background instead: `scripts/cut_black.py` cuts
a picture on black (brightness becomes transparency), and a plain green one keys out cleanly (see
`key_green` in `scripts/climb_frames.py`).

`import-sprites` (`scripts/fit_frames.py`, Python with Pillow) scales every frame of a pose by the
same factor and places it on a 320x320 canvas: feet on the floor (`--anchor bottom`), the middle
kept still for poses in the air (`--anchor center`), or a coloured marker such as the donut collar
kept in place (`--anchor marker`), with `--order` for play order and a GIF preview. Run it with
`--help` for every option. `npm start` and `npm run build` use `pets/donut-cat` unless the `PET`
environment variable names another pack.

## Layout

```
src/main/main.ts            windows, tick loop, IPC, menu, tray icon, voice session
src/main/pet.ts             state machine + physics (pure, no Electron imports)
src/main/prey.ts            the hunted mouse (pure)
src/main/sprites.ts         sprite discovery + alpha masks for hit-testing
src/main/sounds.ts          sound discovery and picking a file to play
src/main/commands.ts        picking the voice phrase that fits best
src/main/voice.ts           starts the speech worker and talks to it
src/main/whisper-worker.ts  Whisper, in a utility process
src/main/config.ts          the engine's default tuning
src/main/pack.ts            loads and checks a pet pack (dist/pet/pet.json)
src/main/update.ts          self-update of the portable exe from GitHub Releases
src/preload.ts              contextBridge API for the pet window
src/mouse-preload.ts        contextBridge API for the mouse window
src/renderer/               pet canvas, mic badge and recording; mouse canvas
src/shared/types.ts         IPC contract
pets/<id>/                   pet packs (see Pets for clients); pets/donut-cat is this cat
build.mjs                   bundles the code and copies the pack named by PET into dist/pet
scripts/build-pet.mjs       exe for one pack (npm run build-pet / dist)
scripts/publish-pet.mjs     publishes a built exe as a GitHub release (npm run publish-pet)
scripts/new-pet.mjs         starts a pack;  scripts/check-pet.mjs  checks one
scripts/remove_checker.py   cuts figures out of pictures with a painted checkerboard background
scripts/cut_black.py        cuts a picture drawn on a black background
scripts/wheel_rungs.py      spin frames for a pack's wheel drawn at an angle
scripts/fit_in_wheel.py     places run frames inside that wheel's opening
scripts/climb_frames.py     the hamster's getting-into-the-wheel frames, cut from a green sheet
scripts/fit_frames.py       fits artwork into frames (npm run import-sprites)
src/shared/wheel.ts         where the running wheel and the pet inside it are drawn
scripts/contact_sheet.py    one image of every state (npm run preview)
scripts/make_icon.py        multi-size .ico from a frame
scripts/shortcut.mjs        makes the Windows desktop shortcut (npm run shortcut)
scripts/meow-synth.mjs      synthesises cartoon cat sounds
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
- No installer, only the portable exe, and it is not code-signed. The `build` section of `package.json`
  keeps `onnxruntime-node` and `sharp` (native addons) outside the asar archive and leaves out
  the onnxruntime builds for other platforms; keep that in mind when adding dependencies.
