// Bundles the demo into web/dist with esbuild and copies the model files.
//   node build.mjs           production build
//   node build.mjs --watch   rebuild on change
import { build, context } from 'esbuild';
import { cp, mkdir, copyFile } from 'node:fs/promises';

const dist = new URL('./dist/', import.meta.url);
await mkdir(dist, { recursive: true });
const options = {
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  minify: !process.argv.includes('--watch'),
  sourcemap: true,
  target: ['es2020'],
  outfile: 'dist/app.js',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};
await copyFile(new URL('./index.html', import.meta.url), new URL('./index.html', dist));
await cp(new URL('./public/', import.meta.url), dist, { recursive: true });
await copyFile(new URL('../results/metrics.json', import.meta.url), new URL('./metrics.json', dist));
if (process.argv.includes('--watch')) {
  await (await context(options)).watch();
} else {
  await build(options);
}
