import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * "Open at login" for a pet run from its project folder on macOS. Electron's own login items name
 * an app bundle and take no arguments there, so an unpackaged pet would register the bare Electron
 * app. A LaunchAgent starts the same command this copy was started with instead:
 * ~/Library/LaunchAgents/<label>.plist, read by macOS at login. A packaged app does not need this.
 */
const agentFile = (label: string): string => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);

const xml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function opensAtLogin(label: string): boolean {
  return existsSync(agentFile(label));
}

/**
 * @param program the command and its arguments, as full paths
 * @throws when the file cannot be written or removed
 */
export function setOpensAtLogin(label: string, on: boolean, program: readonly string[]): void {
  const file = agentFile(label);
  if (!on) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((part) => `    <string>${xml(part)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`,
  );
}
