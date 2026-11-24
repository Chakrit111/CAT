// Connects Claude Code to the pet: registers scripts/claude-hook.mjs as a hook in Claude Code's
// user settings, so every session on this machine tells the pet what it is doing.
//
//   npm run claude-hooks                  what is registered now, and what install would add
//   npm run claude-hooks -- install       register (again after moving this folder or changing Node)
//   npm run claude-hooks -- remove        take the pet's hooks out again
//
//   --port <n>        the pet's port, when pet.json sets tuning.claude.port
//   --settings <file> another settings file than ~/.claude/settings.json
//
// Only the pet's own entries are touched (those that run claude-hook.mjs). Hooks of other tools in
// the same file stay as they are. The first change keeps a copy of the file next to it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The moments the pet wants to hear about. */
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
const MARK = 'claude-hook.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(1);
  }
  args.splice(at, 2);
  return value;
};
const port = option('--port');
const settingsFile = path.resolve(
  option('--settings') ?? path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json'),
);
const action = args[0] ?? 'status';
if (!['status', 'install', 'remove'].includes(action) || args.length > 1) {
  console.error('usage: npm run claude-hooks -- [install | remove] [--port <n>] [--settings <file>]');
  process.exit(1);
}
if (port !== undefined && !/^\d{2,5}$/.test(port)) {
  console.error('--port must be a port number');
  process.exit(1);
}

// Forward slashes work in every shell Claude Code runs hooks with, Git Bash on Windows included.
const quoted = (file) => `"${file.replaceAll('\\', '/')}"`;
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), MARK);
// This Node by its full path: hooks run without the shell profile that puts `node` on the PATH.
const command = `${quoted(process.execPath)} ${quoted(script)}${port ? ` ${port}` : ''}`;
// async: Claude never waits for the pet.
const entry = () => ({ hooks: [{ type: 'command', command, async: true, timeout: 5 }] });

let settings = {};
if (existsSync(settingsFile)) {
  try {
    settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  } catch (err) {
    console.error(`${settingsFile} is not valid JSON, so it was left alone: ${err.message}`);
    process.exit(1);
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    console.error(`${settingsFile} does not hold a settings object, so it was left alone.`);
    process.exit(1);
  }
}

const isOurs = (hook) => typeof hook?.command === 'string' && hook.command.includes(MARK);
const hooksOf = (group) => (Array.isArray(group?.hooks) ? group.hooks : []);
const current = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
const registered = Object.entries(current)
  .filter(([, groups]) => Array.isArray(groups) && groups.some((group) => hooksOf(group).some(isOurs)))
  .map(([event]) => event);

if (action === 'status') {
  console.log(`settings: ${settingsFile}`);
  console.log(registered.length > 0 ? `registered for: ${registered.join(', ')}` : 'the pet is not registered');
  const missing = EVENTS.filter((event) => !registered.includes(event));
  if (missing.length > 0) {
    console.log(`\n"npm run claude-hooks -- install" would add this hook for ${missing.join(', ')}:`);
    console.log(JSON.stringify(entry(), null, 2));
  }
  process.exit(0);
}

// Without the pet's entries; groups and events left empty by that go too.
const hooks = {};
for (const [event, groups] of Object.entries(current)) {
  // Events the pet has nothing in stay exactly as they are, an empty list included.
  if (!Array.isArray(groups) || !groups.some((group) => hooksOf(group).some(isOurs))) {
    hooks[event] = groups;
    continue;
  }
  const kept = groups
    .map((group) => (hooksOf(group).some(isOurs) ? { ...group, hooks: hooksOf(group).filter((hook) => !isOurs(hook)) } : group))
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
  if (kept.length > 0) hooks[event] = kept;
}
if (action === 'install') {
  for (const event of EVENTS) hooks[event] = [...(hooks[event] ?? []), entry()];
}

const next = { ...settings };
if (Object.keys(hooks).length > 0) next.hooks = hooks;
else delete next.hooks;

if (action === 'remove' && registered.length === 0) {
  console.log('the pet was not registered; nothing changed');
  process.exit(0);
}
if (existsSync(settingsFile)) {
  const backup = `${settingsFile}.before-desktop-pet`;
  if (!existsSync(backup)) {
    copyFileSync(settingsFile, backup);
    console.log(`kept a copy of the settings as they were: ${backup}`);
  }
} else {
  mkdirSync(path.dirname(settingsFile), { recursive: true });
}
writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  action === 'install'
    ? `registered for ${EVENTS.join(', ')} in ${settingsFile}\nSessions that are already open pick this up when they are restarted.`
    : `removed the pet's hooks from ${settingsFile}`,
);
