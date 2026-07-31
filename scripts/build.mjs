import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('assets', { recursive: true });

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2020'],
  outfile: 'assets/app.js'
});

await copyFile(
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  'assets/pdf.worker.min.mjs'
);
