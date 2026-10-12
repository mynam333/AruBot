import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'local-program/fx-viewer-dist');
await fs.mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['local-program/fx-viewer.tsx'],
  outfile: path.join(output, 'viewer.js'),
  bundle: true,
  platform: 'browser',
  target: 'chrome109',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_BASE': '""' },
});
const css = await postcss([tailwindcss({
  content: [path.join(root, 'src/components/FxOverlay.tsx'), path.join(root, 'local-program/fx-viewer.tsx')],
})]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
await fs.writeFile(path.join(output, 'viewer.css'), css.css);
console.log('Local FX viewer built from the shared web overlay.');
