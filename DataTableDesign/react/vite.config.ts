/// <reference types="vitest/config" />
import { cpSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * `./fonts.css` is a separate, opt-in entry point in package.json (hosts that
 * already ship Archivo should not be forced to download it). Vite's lib mode
 * only emits what the entry graph imports, so the font folder is copied
 * verbatim instead — the woff2 files land next to the CSS that url()s them.
 *
 * This is why src/lib/DataTable.css must NOT `@import './fonts/fonts.css'`:
 * that would inline the faces into dist/data-table.css and defeat the split.
 */
function copyFontFolder(): Plugin {
  return {
    name: 'dt-copy-font-folder',
    apply: 'build',
    closeBundle() {
      const from = here('./src/lib/fonts')
      if (!existsSync(from)) {
        this.warn('src/lib/fonts not found — dist/fonts/fonts.css will be missing')
        return
      }
      cpSync(from, here('./dist/fonts'), { recursive: true })
    },
  }
}

export default defineConfig({
  // valorant.html talks to server.py at the repo root. Proxying keeps the page
  // same-origin with the API, so the server needs no CORS header — and without
  // one, another site the browser has open cannot make this machine scrape.
  server: {
    proxy: {
      '/api': {
        // start.bat can move the API off 8787; follow it so the two agree.
        target: `http://127.0.0.1:${process.env.VT_SERVER_PORT || '8787'}`,
        changeOrigin: true,
        // Scrapes are server-sent events that idle for a minute while
        // Cloudflare is solved; the proxy must not buffer or time them out.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },

  plugins: [
    react(),
    dts({
      include: ['src/index.ts', 'src/lib'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}'],
      outDir: 'dist',
      insertTypesEntry: true,
      tsconfigPath: './tsconfig.json',
    }),
    copyFontFolder(),
  ],

  // `npm run dev` / `npm run preview` serve index.html + src/demo.
  // `npm run build` runs the library build configured below.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    // One stylesheet for the whole library rather than per-chunk CSS.
    cssCodeSplit: false,
    lib: {
      entry: here('./src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // Nothing React-shaped may be bundled: react/react-dom are peers.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
      ],
      output: {
        // The component is stateful, so a Next.js App Router host must treat it
        // as a client module. Emitted as a banner because bundlers strip
        // module-level directives from the source.
        banner: "'use client';",
        assetFileNames(asset) {
          const name = asset.names?.[0] ?? ''
          // Keep the emitted stylesheet at the path package.json exports.
          if (name.endsWith('.css')) return 'data-table.css'
          if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) return 'fonts/[name][extname]'
          return 'assets/[name][extname]'
        },
      },
    },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
