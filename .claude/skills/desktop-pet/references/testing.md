# Testing the pet without touching the user's mouse

The user's own pet is usually running and they interact with it during your work. Expect extra
`[voice]` lines, drags and menu clicks in your results that you did not cause; read logs with
that in mind and keep tests short.

## 1. Free the single-instance lock

```powershell
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in 'Desktop Pet','Desktop-Pet-0.1.0-portable' -or $_.Path -like '*pet project*' } | Stop-Process -Force
Get-ChildItem $env:TEMP -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'Desktop Pet.exe') } | Remove-Item -Recurse -Force
```

## 2. Start a test pet you can drive

Dev build (after `npm run build`), in the background so you keep its log:

```bash
cd "/c/Users/Teen/Desktop/pet project" && ./node_modules/electron/dist/electron.exe . --remote-debugging-port=9333 2>&1 | grep --line-buffered -vE "disk_cache|gpu_disk_cache|cache_util"
```

Packaged app (after `npm run dist`): `"release/donut-cat/win-unpacked/Desktop Pet.exe"` with the
same flags. Another pack: `PET=<id> node build.mjs` first (and `npm run build` afterwards to put
donut-cat back), or `release/<id>/win-unpacked/<productName>.exe`; its process name is its
productName, which `menu.ps1` does not look for - pass the dev build instead.
The portable exe forwards flags too, and its app sees `PORTABLE_EXECUTABLE_FILE`.

Fake microphone (no real mic, no user voice), add:

```
--use-fake-ui-for-media-stream --use-fake-device-for-media-stream "--use-file-for-fake-audio-capture=<skill>/assets/voice-samples/sleep.wav"
```

`assets/voice-samples/`: sit, jump (โดด), stand, run (ไล่หนู), sleep (นอน), walk, roll, chase
(ไล่โดนัท), wake (ตื่น - heard as เดิน). Windows Thai TTS, ~2 s each. The file loops, so every
right-click "says" it again.

Wait for `[voice] model ready` in the log before right-clicking, or the first right-click opens
the menu instead of listening.

## 3. Drive it

- `node scripts/cdp-eval.cjs "<js>"` evaluates in the pet window's page (main world, same as
  renderer.ts). `window.pet.contextMenu()` = a right-click.
- `powershell -NoProfile -File scripts/menu.ps1 [-Click 'Sleep']` opens the menu over CDP, lists
  items with checkbox states (`Sounds [On]`), clicks one through UI Automation, or closes it.
- Sounds: inject `scripts/sound-hook.js` once (`node cdp-eval.cjs (Get-Content sound-hook.js -Raw)`),
  trigger events, then read `JSON.stringify(window.__plays)`: per sound `playing`, `endedAfterMs`,
  `cutAfterMs`, `error`. Injecting twice records every play twice. A CSP block shows as
  `error: MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check` plus a `[renderer]` line.
- Voice end to end: fake mic + `window.pet.contextMenu()` once, wait ~6 s, read the log.
- Hunt: `menu.ps1 -Click 'Chase the mouse'`, then poll the UIA window named `Desktop Pet mouse`
  (visible only during a hunt) and the cat window `Desktop Pet` for positions.
- Screenshot of the pet window: CDP `Page.captureScreenshot` (several in one connection to catch
  animation frames - separate node processes are ~0.4 s apart and alias with 4 fps).
- Something that only happens on a timer (chatter every 4-6 min): set the config to seconds,
  build, test, then set it back and rebuild - and check the built value
  (`grep -oE "chatterMs: \{[^}]*\}" dist/main.js`).
- A real drag needs the real mouse (`SetCursorPos` + `mouse_event`). Avoid; if needed, warn the
  user first. Their own drags often happen anyway - the log/plays will show them.

## 4. Settings you may touch

Sounds and Start with Windows persist (`%APPDATA%\desktop-pet\settings.json`, `HKCU\...\Run`).
Back up `settings.json` before a test that needs sounds on, restore it after, and say so. Check
the login item with
`(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').'electron.app.Desktop Pet'`.

## 5. Useful one-liners

- Sound durations:
  `$s = New-Object -ComObject Shell.Application; Get-ChildItem assets\sounds -Recurse -File | % { "{0} {1:N1}s" -f $_.Name, ($s.Namespace($_.DirectoryName).ParseName($_.Name).ExtendedProperty('System.Media.Duration')/1e7) }`
- What is in the exe: `node scripts/asar-check.cjs "<repo>" <id>` (exit 1 on any difference).
- The pack loader alone, no app: `npx esbuild src/main/pack.ts --bundle --platform=node --format=cjs --outfile=<scratch>/pack.cjs`,
  then `require(...).loadPack('<pack dir>')` - prints the merged config or the `PackError` list.
- Listening to synthesised sounds: open the WAV with `Start-Process`; the user's output device is
  in the tray volume button's name (UIA, `Shell_TrayWnd`).

## Testing the updater without publishing

Dev builds only honour three variables (a packaged exe ignores them):
`PET_UPDATE_EXE` = a stand-in file to "update", `PET_UPDATE_API` = release-list URL,
`PET_UPDATE_DOWNLOADS` = prefix asset URLs must have.

1. Scratch folder with a stand-in `hamster-1.0.0-portable.exe` (any small file) and a payload to
   serve as the new exe (a copy of `C:\Windows\System32\whoami.exe` is harmless if relaunched).
2. `node .claude/skills/desktop-pet/scripts/update-server.cjs <payload> 8765 [bad]` - a fake
   GitHub release list for pet `hamster` (1.0.1 plus releases that must be ignored: another pet,
   older, draft, foreign host). `bad` serves a wrong checksum.
3. Start the dev pet with `PET_UPDATE_EXE=<stand-in>`, `PET_UPDATE_API=http://127.0.0.1:8765/releases`,
   `PET_UPDATE_DOWNLOADS=http://127.0.0.1:8765/dl/`, stdout to a log. The first check runs after 60 s.
   Expect `[update] downloading 1.0.1` then `... is ready`, and `<stand-in>.new` with the payload's
   SHA-256; with `bad`: `does not match the release checksum` and no `.new` or `.download`.
4. Menu "Restart to update (1.0.1)" (menu.ps1 -Click), or Quit, swaps the stand-in; a `.new` present
   at start is swapped at once and the pet quits.
5. The real exe (locked while running): copy the built exe to a scratch folder, put a copy next to
   it as `<name>.new`, start it - within about 50 s the `.new` is gone, the exe has the copy's
   timestamp and the pet is running again.

## 6. Finish

Stop the test pet (`TaskStop` the background task, then kill leftover processes), remove temp
folders, restore settings, make sure `dist/pet` is donut-cat (`npm run build`), start the user's
pet normally: `Start-Process 'C:\Users\Teen\Desktop\pet project\release\donut-cat\Desktop-Pet-0.1.0-portable.exe'`.
