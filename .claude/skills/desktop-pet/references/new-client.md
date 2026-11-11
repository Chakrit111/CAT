# A pet for a client

## Workflow

1. `npm run new-pet -- <id> --name "Client Pet"` - empty pack, voice off. `--from donut-cat` copies a
   working pack (sprites, sounds, icon) to start from. `<id>`: a-z, 0-9, "-".
2. Put the client's artwork in `pets/<id>/art/` and fit each state with
   `npm run import-sprites` (see SKILL.md). Look at every result before moving on. Artwork from AI
   tools is often JPG with a painted checkerboard: cut it out first with
   `python -I scripts/remove_checker.py <jpg> <out> [--name x] [--keep-largest]` (splits sheets of
   several poses; check the cut-outs on dark and green). Translucent things (a glass wheel, glow)
   over the checkerboard cannot be recovered - ask for PNG or a plain background instead. Pictures
   from different sheets come at different scales: bring them to one scale (eye/ear size) before
   fitting with `--scale-by fixed`. pets/hamster is a worked example (art/cut/).
3. Icon: `python -I scripts/make_icon.py pets/<id>/sprites/idle/0.png pets/<id>/icon.ico <preview.png> <left,top,right,bottom of the head>`
   (small sizes use the head crop, large ones the whole body; it must contain a 256x256 image).
4. Edit `pets/<id>/pet.json`: productName (exe + tray name), packageName (settings folder; must be
   unique), appId, version, `features`, `menu` labels (drop commands the pet has no frames for),
   `voice.phrases` if voice is on, `tuning` (only the keys that differ).
5. Sounds: synthesise (`node scripts/meow-synth.mjs pets/<id>/sounds`) or licensed files.
6. `npm run check-pet -- <id>` until clean, then `npm run preview -- pets/<id>/sprites <png>` for the
   client to approve.
7. `npm run build-pet -- <id> --run` to try it; `npm run build-pet -- <id>` for the exe in
   `release/<id>/`. Then `npm run build` so dist/ is donut-cat again.
8. Test as in testing.md (process name = productName). Clean up any test pack you made
   (`pets/<id>`, `release/<id>`, `%APPDATA%\<packageName>`).

## A pet that runs in its own wheel (`runMode: "wheel"`, pets/hamster)

Ask for the wheel alone and the run frames on a plain green or black background, never a painted
checkerboard. If the wheel is drawn at an angle (3/4 view), do not use `wheel.hub`: it tilts.
1. Measure two ellipses on the wheel picture (320x320), in pixels: the opening the pet runs behind
   and the back plate. Scan rows and columns for the dark outlines and fit `cx,cy,a,b`.
2. `python -I scripts/wheel_rungs.py <wheel.png> pets/<id>/wheel --front <opening> --back <plate>`
   writes `wheel/0..3.png`; keep the original picture in `art/cut/`.
3. Fit the run frames as usual (bottom-anchored) into `art/cut/run-fit/`, then
   `python -I scripts/fit_in_wheel.py pets/<id>/art/cut/run-fit pets/<id>/sprites/run --opening <opening> --wheel pets/<id>/wheel/0.png --preview <png>`.
4. pet.json `tuning.wheel`: `scale: 1`, `floor: 1`, `centerX: 0.5`, `opening` = the opening
   ellipse divided by 320.
5. Getting-in frames are optional (`wheel-enter/<n>.png`, the pet alone). If the artist drew pet
   and wheel together, `scripts/climb_frames.py` is the hamster's worked example: it keys the green,
   keeps only the pet, scales it to the other poses and fits it into the opening. Its panel boxes
   and colour tests are for that sheet; adapt them. Check tails and outlines in the result: thin,
   dark parts are the first to go missing.
The pet must be the same size in every pose, wheel included: compare head sizes on one sheet.

## What to ask the client for

- Art spec: PNG with real transparency, character facing right, same character scale in every
  frame, whole character in frame, no baked ground shadow, any size. Minimum: idle; strongly
  recommended: walk, sit, sleep, drag (held up), fall; optional: run, stand, jump, roll, chase.
  Looping states should loop seamlessly. A distinctive colour feature (like the collar) makes
  scaling poses consistently easier (`--anchor marker`).
- Rights to the artwork and any sounds they supply.
- Which features they want (voice, hunt, sounds, start with Windows) - this also prices the job.

## Limits to know

- The hunted mouse (`src/renderer/mouse.ts`, drawn in code) and the sound-per-event mapping are
  engine-wide, not per pack.
- Voice is Thai-tuned (closed set, whisper-small); another language needs its own phrases and
  testing with real speakers.
- Menu items other than commands (Sounds, Start with Windows, Quit) and tray labels are English.

## Before shipping to a client

- Code-signing certificate, or every user sees "Windows protected your PC" (More info -> Run anyway).
- Portable exe vs installer: portable unpacks ~450 MB on every start (~10 s); an NSIS installer
  starts faster and can create shortcuts. `electron-updater` if you will maintain it.
- Licences: Electron (MIT), transformers.js / onnxruntime (MIT/Apache), Whisper weights (MIT).
  Sounds from free sites (Pixabay etc.) may not allow redistribution as standalone files - prefer
  synthesised or licensed audio.
- Keep client packs out of the public `Chakrit111/CAT` repo (private repo, or a folder that is
  never committed).
- Contract: engine stays yours (licensed to the client); the character and art are theirs.
