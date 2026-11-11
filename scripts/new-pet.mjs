// Starts a new pet pack in pets/<id>/.
// usage: node scripts/new-pet.mjs <id> [--name "Product Name"] [--from <pack>]
//   (npm run new-pet -- <id> --name "Acme Cat")
// Without --from: an empty pack (folders for every state and sound) whose pet.json is based on
// donut-cat's, with voice off. With --from: a copy of that pack's sprites, sounds and icon too
// (not its art/), to start from a working pet.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, STATES } from './check-pet.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = args[0];
if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
  console.error('usage: npm run new-pet -- <id> [--name "Product Name"] [--from <pack>]   (id: a-z, 0-9, -)');
  process.exit(2);
}
const dir = path.join(root, 'pets', id);
if (existsSync(dir)) {
  console.error(`pets/${id} already exists`);
  process.exit(1);
}
const from = option('--from');
const template = path.join(root, 'pets', from ?? 'donut-cat', 'pet.json');
if (!existsSync(template)) {
  console.error(`no pack to start from: ${template}`);
  process.exit(1);
}

const titleCase = id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const base = JSON.parse(readFileSync(template, 'utf8'));
const pet = {
  ...base,
  id,
  productName: option('--name') ?? titleCase,
  packageName: id,
  appId: `io.github.chakrit111.pet.${id.replace(/-/g, '')}`,
  version: '1.0.0',
  features: from ? base.features : { voice: false, hunt: true, sounds: true },
  tuning: from ? base.tuning : {},
};

mkdirSync(path.join(dir, 'art'), { recursive: true });
if (from) {
  for (const name of ['sprites', 'sounds', 'icon.ico']) {
    const src = path.join(root, 'pets', from, name);
    if (existsSync(src)) cpSync(src, path.join(dir, name), { recursive: true });
  }
} else {
  for (const state of STATES) mkdirSync(path.join(dir, 'sprites', state), { recursive: true });
  for (const sound of SOUNDS) mkdirSync(path.join(dir, 'sounds', sound), { recursive: true });
}
writeFileSync(path.join(dir, 'pet.json'), `${JSON.stringify(pet, null, 2)}\n`);

console.log(`created pets/${id}/ (${from ? `copied from ${from}` : 'empty'})
next:
  1. put the client's artwork in pets/${id}/art/<state>/
  2. fit it:   npm run import-sprites -- pets/${id}/art/idle pets/${id}/sprites/idle --scale-by height --anchor bottom --target 220
  3. icon:     python -I scripts/make_icon.py pets/${id}/sprites/idle/0.png pets/${id}/icon.ico <preview.png> <head box>
  4. edit pets/${id}/pet.json (names, menu, features, tuning)
  5. npm run check-pet -- ${id}   then   npm run build-pet -- ${id} --run   then   npm run build-pet -- ${id}`);
