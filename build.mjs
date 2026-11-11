// Bundles main / preload / renderer with esbuild and copies one pet pack into dist/pet/.
// Type-checking is separate: `npm run typecheck`.
// The pack is pets/<PET>/ (environment variable), pets/donut-cat/ by default.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'info' };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron'] };

const pet = process.env.PET || 'donut-cat';
const packDir = path.join('pets', pet);
if (!existsSync(path.join(packDir, 'pet.json'))) {
  console.error(`[build] no pet pack at ${packDir} (pet.json missing). Packs: npm run new-pet -- <id>`);
  process.exit(1);
}

/** What the app reads at run time. art/ (original artwork) stays behind. */
async function copyPack() {
  await rm('dist/pet', { recursive: true, force: true });
  await mkdir('dist/pet', { recursive: true });
  for (const name of ['pet.json', 'icon.ico', 'sprites', 'sounds']) {
    const from = path.join(packDir, name);
    if (existsSync(from)) await cp(from, path.join('dist/pet', name), { recursive: true });
  }
  console.log(`[build] pet pack: ${packDir} -> dist/pet`);
}

try {
  await mkdir('dist', { recursive: true });
  await Promise.all([
    copyPack(),
    build({ ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' }),
    build({ ...node, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' }),
    build({ ...node, entryPoints: ['src/mouse-preload.ts'], outfile: 'dist/mouse-preload.js' }),
    build({
      ...node,
      // transformers.js loads native addons (onnxruntime-node, sharp), so it is required
      // from node_modules at run time instead of being bundled.
      external: ['electron', '@huggingface/transformers'],
      entryPoints: ['src/main/whisper-worker.ts'],
      outfile: 'dist/whisper-worker.js',
    }),
    build({
      ...common,
      platform: 'browser',
      format: 'iife',
      entryPoints: ['src/renderer/renderer.ts'],
      outfile: 'dist/renderer.js',
    }),
    build({
      ...common,
      platform: 'browser',
      format: 'iife',
      entryPoints: ['src/renderer/mouse.ts'],
      outfile: 'dist/mouse.js',
    }),
    copyFile('src/renderer/index.html', 'dist/index.html'),
    copyFile('src/renderer/mouse.html', 'dist/mouse.html'),
  ]);
} catch (err) {
  console.error('[build] failed:', err);
  process.exit(1);
}
