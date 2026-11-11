# A pet for a client

## Workflow

1. `npm run new-pet -- <id> --name "Client Pet"` - empty pack, voice off. `--from donut-cat` copies a
   working pack (sprites, sounds, icon) to start from. `<id>`: a-z, 0-9, "-".
2. Put the client's artwork in `pets/<id>/art/<state>/` and fit each state with
   `npm run import-sprites` (see SKILL.md). Look at every result before moving on.
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
