// Compares a pet pack (pets/<id>/: pet.json, icon.ico, sprites/, sounds/) with the copy packed into
// its last build (release/<id>/win-unpacked/resources/app.asar -> dist/pet/), so you know the exe
// carries exactly the frames, sounds and settings you meant to ship.
// usage: node asar-check.cjs <repo> <id>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [root, id] = process.argv.slice(2);
if (!root || !id) {
  console.error('usage: node asar-check.cjs <repo> <id>');
  process.exit(2);
}
const asar = require(path.join(root, 'node_modules', '@electron', 'asar'));
const archive = path.join(root, 'release', id, 'win-unpacked', 'resources', 'app.asar');
const pack = path.join(root, 'pets', id);
const hash = (b) => crypto.createHash('sha1').update(b).digest('hex');
// The archive lists Windows paths with a leading backslash; compare as forward-slash paths under dist/pet.
const norm = (p) => p.replace(/^[\\/]+/, '').split(/[\\/]/).join('/');
const read = (p) => asar.extractFile(archive, p.split('/').join(path.sep));

const inExe = new Set();
for (const p of asar.listPackage(archive).map(norm)) {
  if (!p.startsWith('dist/pet/')) continue;
  try {
    read(p);
    inExe.add(p.slice('dist/pet/'.length)); // a file, not a folder
  } catch {
    // folders cannot be extracted
  }
}

const onDisk = [];
for (const name of ['pet.json', 'icon.ico', 'wheel', 'wheel-enter', 'wheel.png', 'sprites', 'sounds']) {
  const top = path.join(pack, name);
  if (!fs.existsSync(top)) continue;
  (function walk(p) {
    if (fs.statSync(p).isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else onDisk.push(norm(path.relative(pack, p)));
  })(top);
}

let problems = 0;
for (const p of onDisk) {
  const same = inExe.has(p) && hash(read(`dist/pet/${p}`)) === hash(fs.readFileSync(path.join(pack, p)));
  if (!same) {
    problems++;
    console.log(`${inExe.has(p) ? 'DIFFERS' : 'MISSING'}  ${p}`);
  }
}
for (const p of inExe) {
  if (!onDisk.includes(p)) {
    problems++;
    console.log(`EXTRA    ${p} (in the exe, not in pets/${id})`);
  }
}
console.log(`pets/${id}: ${onDisk.length} files, ${inExe.size} in the build, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
