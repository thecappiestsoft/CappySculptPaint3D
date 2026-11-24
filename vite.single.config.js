import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// Vite leaves <link rel="icon"> as a separate file; inline it as a data URI so the build is truly one file.
const inlineFavicon = {
  name: 'inline-favicon',
  enforce: 'pre',
  transformIndexHtml(html) {
    const svg = readFileSync(new URL('./src/assets/icon.svg', import.meta.url), 'utf8');
    const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    return html.replace(/(<link rel="icon"[^>]*href=")[^"]*(")/, `$1${uri}$2`);
  },
};

export default defineConfig({
  base: './',
  plugins: [inlineFavicon, viteSingleFile()],
  build: { outDir: 'dist-single', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
});
