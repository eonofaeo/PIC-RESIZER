import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('assets', { recursive: true });

// ESM output so runtime dynamic import() of the BG CDN module works.
// @imgly/background-removal is loaded from a full CDN URL inside src/bg.js
// and is never bundled (keeps cold load light).
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2020'],
  format: 'esm',
  outfile: 'assets/app.js'
});

await copyFile(
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  'assets/pdf.worker.min.mjs'
);
