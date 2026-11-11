// Builds one pet pack into a portable Windows exe: release/<id>/<Product-Name>-<version>-portable.exe
// usage: node scripts/build-pet.mjs <id> [--run]      (npm run build-pet -- <id>)
//   --run   only build dist/ with that pack and start it (no exe): to try a pack quickly.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPet, exeName as exeNameOf, report } from './check-pet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const runOnly = process.argv.includes('--run');
if (!id || id.startsWith('-')) {
  console.error('usage: npm run build-pet -- <id> [--run]');
  process.exit(2);
}

const result = checkPet(root, id);
report(id, result);
if (result.errors.length) process.exit(1);
const pet = result.pet;
const exeName = exeNameOf(pet);

// A running copy of this pet locks the exe that the build replaces, and the build then waits forever.
if (!runOnly && process.platform === 'win32') {
  const tasks = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).toLowerCase();
  const running = [`${pet.productName}.exe`, exeName].filter((n) => tasks.includes(`"${n.toLowerCase()}"`));
  if (running.length) {
    console.error(`Close the pet first: ${running.join(', ')} is running and would lock the exe.`);
    process.exit(1);
  }
}

execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, PET: id } });

if (runOnly) {
  const electron = createRequire(import.meta.url)('electron'); // the package exports the binary's path
  spawn(electron, ['.'], { cwd: root, stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
} else {
  const builder = createRequire(import.meta.url)('electron-builder');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const output = path.join('release', id);
  await builder.build({
    projectDir: root,
    win: ['portable'],
    config: {
      ...pkg.build,
      appId: pet.appId,
      productName: pet.productName,
      directories: { output },
      win: { ...pkg.build.win, icon: path.join('pets', id, 'icon.ico') },
      portable: { artifactName: exeName },
      // The app's own package.json inside the exe: its name and version are this pet's.
      extraMetadata: { name: pet.packageName, version: pet.version, productName: pet.productName },
    },
  });
  // The checksum goes into the release next to the exe: running pets verify an update against it.
  const exePath = path.join(root, output, exeName);
  const sha = createHash('sha256').update(readFileSync(exePath)).digest('hex');
  writeFileSync(`${exePath}.sha256`, `${sha}  ${exeName}\n`);
  console.log(`\nbuilt ${exePath}\n      ${exeName}.sha256`);
}
