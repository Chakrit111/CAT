// Creates (or updates) a "Desktop Pet" shortcut on the desktop that starts this copy of the pet
// without a terminal: a .lnk on Windows, a small app on macOS. Run it through `npm run shortcut`,
// which builds first: the shortcut starts the last build in dist/, not the sources, and points at
// this folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stop(message) {
  console.error(`npm run shortcut: ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32' && process.platform !== 'darwin') {
  stop('desktop shortcuts are only made on Windows and macOS. Start the pet with `npm start`.');
}

const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'Electron.app');
if (!existsSync(electron)) stop(`${electron} not found. Run \`npm install\` first.`);
if (!existsSync(path.join(root, 'dist', 'main.js'))) {
  stop('dist/main.js not found. Run `npm run build` first.');
}
// The pet last built into dist/ (pets/donut-cat unless PET was set): its icon and name.
const icon = path.join(root, 'dist', 'pet', 'icon.ico');
const { productName, packageName } = JSON.parse(readFileSync(path.join(root, 'dist', 'pet', 'pet.json'), 'utf8'));

if (process.platform === 'darwin') {
  macShortcut();
  process.exit(0);
}

/**
 * macOS: ~/Desktop/<productName>.app, an AppleScript applet that opens Electron on this folder.
 * (A bundle whose program is a shell script does not open on Apple-silicon Macs without Rosetta;
 * an applet is a real program, and macOS makes one without any developer tools installed.)
 */
function macShortcut() {
  const app = path.join(os.homedir(), 'Desktop', `${productName}.app`);
  const id = `com.desktop-pet.${packageName}.shortcut`;
  const run = (file, args) => execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const existed = existsSync(app);
  if (existed) {
    // Only ever replace a shortcut this script made.
    let owner = '';
    try {
      owner = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(app, 'Contents', 'Info.plist')]).trim();
    } catch {
      // not an app, or no Info.plist
    }
    if (owner !== id) stop(`${app} exists and is not this pet's shortcut; move it away first.`);
    rmSync(app, { recursive: true });
  }

  const work = mkdtempSync(path.join(os.tmpdir(), 'pet-shortcut-'));
  try {
    const quote = (text) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const script = [
      `set electronApp to ${quote(electron)}`,
      `set petFolder to ${quote(root)}`,
      'try',
      '  do shell script "test -d " & quoted form of electronApp & " && test -f " & quoted form of (petFolder & "/dist/main.js")',
      'on error',
      `  display alert ${quote(productName)} message "The pet was not found in " & petFolder & ". If the folder moved, run npm run shortcut there again."`,
      '  return',
      'end try',
      'do shell script "/usr/bin/open -a " & quoted form of electronApp & " --args " & quoted form of petFolder',
    ].join('\n');
    const source = path.join(work, 'shortcut.applescript');
    writeFileSync(source, script);
    run('/usr/bin/osacompile', ['-o', app, source]);

    // The pet's own picture: the largest PNG inside icon.ico, at the sizes an .icns wants.
    const png = largestPng(readFileSync(icon));
    if (png) {
      const base = path.join(work, 'icon.png');
      const set = path.join(work, 'pet.iconset');
      writeFileSync(base, png);
      mkdirSync(set);
      for (const size of [16, 32, 128, 256]) {
        run('/usr/bin/sips', ['-z', String(size), String(size), base, '--out', path.join(set, `icon_${size}x${size}.png`)]);
        if (size * 2 <= 256) run('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), base, '--out', path.join(set, `icon_${size}x${size}@2x.png`)]);
      }
      run('/usr/bin/iconutil', ['-c', 'icns', set, '-o', path.join(app, 'Contents', 'Resources', 'applet.icns')]);
      // An applet may also carry its icon in an asset catalog, which would win over the .icns.
      rmSync(path.join(app, 'Contents', 'Resources', 'Assets.car'), { force: true });
    } else {
      console.warn('npm run shortcut: no PNG picture inside icon.ico; the shortcut keeps the script icon.');
    }

    const plist = path.join(app, 'Contents', 'Info.plist');
    const set = (key, type, value) => run('/usr/bin/plutil', ['-replace', key, type, value, plist]);
    set('CFBundleIdentifier', '-string', id);
    set('CFBundleName', '-string', productName);
    set('LSUIElement', '-bool', 'YES'); // it only starts the pet: no Dock icon of its own
    try {
      run('/usr/bin/plutil', ['-remove', 'CFBundleIconName', plist]);
    } catch {
      // no asset-catalog icon named
    }
    // The bundle changed after osacompile signed it.
    run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  } catch (err) {
    rmSync(app, { recursive: true, force: true });
    stop(`could not make the shortcut: ${err.stderr?.trim() || err.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`${existed ? 'Updated' : 'Created'} ${app}`);
}

/** The largest PNG-encoded picture inside an .ico file, or undefined if it has none. */
function largestPng(ico) {
  let best;
  let bestWidth = 0;
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16;
    const width = ico.readUInt8(entry) || 256; // 0 stands for 256
    const data = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
    if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47 && width > bestWidth) {
      best = data;
      bestWidth = width;
    }
  }
  return best;
}

// The paths travel as environment variables and the script as -EncodedCommand (UTF-16LE base64),
// so spaces or non-ASCII characters in a folder name cannot break the quoting.
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$link = Join-Path ([Environment]::GetFolderPath('Desktop')) ($env:PET_NAME + '.lnk')
$existed = Test-Path -LiteralPath $link
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = $env:PET_ELECTRON
$shortcut.Arguments = '"' + $env:PET_ROOT + '"'
$shortcut.WorkingDirectory = $env:PET_ROOT
$shortcut.IconLocation = $env:PET_ICON + ',0'
$shortcut.Description = $env:PET_NAME
$shortcut.Save()
if ($existed) { 'Updated ' + $link } else { 'Created ' + $link }
`;

try {
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PET_ROOT: root,
        PET_ELECTRON: electron,
        PET_ICON: icon,
        PET_NAME: productName,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  console.log(output.trim());
} catch {
  stop('PowerShell could not create the shortcut (see the error above).');
}
