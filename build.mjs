// Bundles main / preload / renderer with esbuild. Type-checking is separate: `npm run typecheck`.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const common = { bundle: true, sourcemap: true, target: 'es2022', logLevel: 'info' };
const node = { ...common, platform: 'node', format: 'cjs', external: ['electron'] };

try {
  await mkdir('dist', { recursive: true });
  await Promise.all([
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
