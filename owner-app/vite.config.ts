import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// index.html cannot import JSON, so the product name is injected at build time
// from the same product.json the app imports. Nothing is hardcoded in the HTML.
const product = JSON.parse(readFileSync(fileURLToPath(new URL('./src/product.json', import.meta.url)), 'utf8')) as { name: string };

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'product-html',
      transformIndexHtml(html) {
        return html.replace(/%PRODUCT_NAME%/g, product.name);
      },
    },
  ],
});
