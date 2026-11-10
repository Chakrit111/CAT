// Creates (or updates) a "Desktop Pet" shortcut on the Windows desktop that starts this copy of
// the pet without a terminal. Run it through `npm run shortcut`, which builds first: the shortcut
// starts the last build in dist/, not the sources, and points at this folder.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stop(message) {
  console.error(`npm run shortcut: ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  stop('desktop shortcuts are only made on Windows. Start the pet with `npm start`.');
}

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!existsSync(electron)) stop(`${electron} not found. Run \`npm install\` first.`);
if (!existsSync(path.join(root, 'dist', 'main.js'))) {
  stop('dist/main.js not found. Run `npm run build` first.');
}

// The paths travel as environment variables and the script as -EncodedCommand (UTF-16LE base64),
// so spaces or non-ASCII characters in a folder name cannot break the quoting.
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$link = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Desktop Pet.lnk'
$existed = Test-Path -LiteralPath $link
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$shortcut.TargetPath = $env:PET_ELECTRON
$shortcut.Arguments = '"' + $env:PET_ROOT + '"'
$shortcut.WorkingDirectory = $env:PET_ROOT
$shortcut.IconLocation = $env:PET_ICON + ',0'
$shortcut.Description = 'Desktop Pet'
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
        PET_ICON: path.join(root, 'assets', 'icon.ico'),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  console.log(output.trim());
} catch {
  stop('PowerShell could not create the shortcut (see the error above).');
}
