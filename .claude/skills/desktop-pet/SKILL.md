---
name: desktop-pet
description: How to work on this Electron + TypeScript desktop pet engine and its pet packs (the shipped one is the donut-collar cat that walks on the taskbar, hunts a mouse, meows and takes Thai voice commands) - adding or replacing sprite poses, sounds and voice phrases, tuning behaviour, making a new pet for a client from a pack, building the portable .exe, testing it without touching the user's mouse, and publishing a GitHub release. Use it for any task in this repository, even small ones, and whenever the user talks about the pet, the cat, the widget, its poses or frames (ท่า, รูป, เฟรม, sprite), its sounds (เสียง, เสียงแมว, meow, purr), voice commands (คำสั่งเสียง), the tray, start with Windows, building or rebuilding the exe (build ใหม่, ทำ exe), a release, or making a pet for a customer (ทำ pet ให้ลูกค้า).
---

# Desktop pet

A transparent, always-on-top Electron 45 + TypeScript (strict) pet engine for Windows. Repo:
`C:\Users\Teen\Desktop\pet project` (GitHub `Chakrit111/CAT`, public). Everything that makes a pet
that pet lives in a **pack**, `pets/<id>/` (pet.json, icon.ico, sprites/, sounds/, art/); the
user's own cat is `pets/donut-cat`. The README is the user-facing manual; this skill is the
working knowledge behind it. Read `references/architecture.md` before changing code,
`references/testing.md` before verifying anything, `references/new-client.md` for a new pet.

## Working with this user

- Replies in short Thai, technical terms in English. They are not a developer by trade: say what
  changed in terms of what the cat does, then the details.
- They almost always have the pet running (the portable exe) and keep playing with it while you
  work. Their clicks, drags, voice commands and menu toggles show up in your logs and test results.
  Before a build or a test, close it; afterwards start their pet again (see "Restart the user's pet").
- Never move the real mouse to test something if CDP + UI Automation can do it
  (`scripts/menu.ps1`). If you must, say so first.
- If you switch a setting for a test (Sounds, Start with Windows), back it up first, put it back
  and say so.
- Commit or push only when asked. Ask before publishing a release.
- They drop new files straight into the folders (sprite folders, sound folders) with whatever
  names the tool gave them. Inspect before using: real format, size, transparency, duration.

## Common tasks

### New or changed poses (sprites)

Frames live in `pets/<id>/sprites/<state>/<n>.png`, 320x320 RGBA, character facing right, played in
numeric file-name order. A state without frames falls back to `idle`. States, frame counts and fps
are in `references/architecture.md`.

1. Inspect what the user dropped in: `python -I` + Pillow - size, mode, opaque bbox, file names.
   Look at the images (Read them) so you can describe the poses and pick an order.
2. Move the originals out of the sprite folder to `pets/<id>/art/<state>/`: the app loads any PNG
   left there, and `npm run check-pet` reports non-numeric names as errors.
3. Fit them with `npm run import-sprites -- <src> <out> ...` (`scripts/fit_frames.py`) - same scale
   for every frame, placed so the motion reads:
   ```
   npm run import-sprites -- pets/donut-cat/art/fall pets/donut-cat/sprites/fall --order 2.png,1.png,2.png,3.png --anchor center --preview <scratch> --fps 8 --replace
   ```
   The shipped drag frames were made with
   `--anchor marker --marker 170,90,90 --marker-upper --marker-axis width --marker-trim 0`
   and order centre, right, centre, left. The marker is the red donut collar (~130 px wide in
   every 320 px frame), which keeps the cat the same size as in the other states. For a character
   without such a feature use `--scale-by height --anchor bottom`. A `CLIPPED` line means part of
   the character falls off the canvas: lower `--target` or change the anchor. Without `--replace`
   it refuses to overwrite existing frames.
4. Send the preview GIF (`SendUserFile`) before building. A pendulum order (A, B, A, C) avoids the
   jump from the last frame back to the first.
5. Set the state's fps under `tuning.states.<state>.fps` in pet.json if needed.
6. Build, check, restart (below). `npm run preview -- pets/<id>/sprites <out.png>` draws every state.

### Sounds

`pets/<id>/sounds/<sound>/` holds any number of `.wav` / `.mp3` / `.ogg` files with any names; one is
picked at random per play (never the same twice in a row). An empty folder is silent. Which event
plays which sound is engine code in `src/main/main.ts` (`onStateChange`, the voice handler, the
pointer-up handler, `chatter`) - it applies to every pack; the current mapping is in
`references/architecture.md`. To change "the sound when X happens", change the `play('<sound>')`
call there, update the README table, rebuild.

- Check durations of new files (Shell `System.Media.Duration`, see testing.md). A long file plays
  to the end unless another sound cuts it - mention it when a file is several seconds long.
- Synthesised cartoon sounds: `node scripts/meow-synth.mjs <out dir>` (deterministic; edit the specs
  at the bottom). Let the user listen first: open the WAV with `Start-Process` - a file card in
  the chat may not play.
- New asset types in the renderer need the page CSP in `src/renderer/index.html` to allow them
  (`media-src file:` was missing once and every sound failed silently except for a console error).
- donut-cat's MP3s are Pixabay downloads: fine inside the app, a licence question in a public
  repo or a client delivery. Say so before committing them.

### Voice commands

Closed-set recognition: `onnx-community/whisper-small` scores every phrase in the pack's
`voice.phrases` against the recording; the best one wins if its score (mean log-prob per token) is
at least `voice.minScore` (-2, `tuning.voice.minScore`). `features.voice: false` skips the worker
and the 240 MB model; right-click then opens the menu directly. Real-voice results were weaker
than TTS tests (4 of 9 right on the first try); ยืน / เดิน / ตื่น get confused. Tune only with
recordings of the user's own voice; `assets/voice-samples/*.wav` (Windows Thai TTS, one per
command) are for regression tests. The user once chose not to tune - don't push it.

### Behaviour and pack settings

`src/main/config.ts` = engine defaults (speeds, gravity, per-state fps and durations, `idleNext`
weights, jump, hunt, voice, `sounds`: volume, purr delay, `chatterMs`). A pack overrides any of them
under `tuning` in pet.json; `src/main/pack.ts` rejects unknown keys and wrong types and lists every
problem in one dialog. pet.json also holds `features` (voice, hunt, sounds), `menu` (commands shown,
in order, with labels) and identity (`productName`, `packageName` = %APPDATA% folder and
single-instance lock, `appId`, `version`).

## Build, check, restart

```
npm run typecheck
npm run build                       # dist/ + pets/donut-cat copied to dist/pet (PET=<id> for another)
npm run check-pet -- <id>           # pack sanity: names, icon, frames, sounds
npm run build-pet -- <id> --run     # try a pack without making an exe
npm run dist                        # = build-pet donut-cat -> release\donut-cat\Desktop-Pet-<ver>-portable.exe (1-2 min)
npm run build-pet -- <id>           # release\<id>\<Product-Name>-<ver>-portable.exe
```

- **Close every pet first**: processes `<productName>` (unpacked app, e.g. `Desktop Pet`), the
  exe's launcher (`Desktop-Pet-0.1.0-portable`) and `electron.exe` under the project. build-pet
  refuses to start while the pet's exe runs (it would lock the output and hang on "output file is
  locked for writing"). If the user starts the pet during the build, tell them to wait.
- After testing another pack, run `npm run build` again: dist/pet must be donut-cat, because the
  desktop shortcut runs dist.
- Check the build carries the pack: `node .claude/skills/desktop-pet/scripts/asar-check.cjs "<repo>" <id>`.
- Each exe start unpacks ~450 MB to `%TEMP%\<random>\`; force-killing leaves it there. Remove
  folders that contain `Desktop Pet.exe` after killing.
- **Restart the user's pet** the way they use it:
  `Start-Process '<repo>\release\donut-cat\Desktop-Pet-0.1.0-portable.exe'` - never with
  `--remote-debugging-port`, which would leave the app controllable by any local process. Their
  Start with Windows entry points at that path.
- The GitHub release v0.1.0 still has an old exe; rebuilds do not update it. Publishing: ask first,
  then `gh release create` / `gh release upload --clobber` (gh is logged in as Chakrit111). Push uses
  Git Credential Manager. Do not read stored tokens yourself - the safety classifier blocks it and
  it is not yours to take.

## Before saying it's done

- typecheck passes; the change is in the build (grep `dist/main.js`, `asar-check.cjs`).
- Exercised in the running app when possible (testing.md: CDP, fake mic, sound hook, menu.ps1);
  say plainly what could not be tested (anything needing a real drag or a real voice).
- dist/pet is donut-cat again; the user's pet is running again, normally; settings you changed are back.
- README updated if behaviour, controls, sounds, pack format or config changed.

## In this environment

A GateGuard hook denies the first Write/Edit of each file and the first Bash call of a session and
asks for facts (importers, affected API, the user's instruction). State them and retry the same call.
