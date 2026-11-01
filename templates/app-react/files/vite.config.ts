import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// Vite corre desde resources/react/{{ app.key }}/: la raíz del proyecto Laravel está 3 niveles arriba.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const laravelRoot = path.resolve(__dirname, '../../..');

// Cada app tiene su puerto, su directorio de build, su hot file y sus alias.
export default defineConfig({
    cacheDir: 'node_modules/.vite-{{ app.key }}',
    root: laravelRoot,
    plugins: [
        laravel({
            input: [
                'resources/react/{{ app.key }}/assets/css/app.css',
                'resources/react/{{ app.key }}/src/app.tsx',
            ],
            refresh: true,
            buildDirectory: '{{ app.build_dir }}',
            hotFile: path.resolve(laravelRoot, 'public/hot-{{ app.key }}'),
        }),
        react(),
        tailwindcss(),
    ],
    resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
            '@assets': path.join(__dirname, 'assets'),
            '@{{ app.key }}': path.join(__dirname, 'src'),
        },
    },
    server: {
        cors: { origin: process.env.APP_URL ?? 'http://localhost' },
        // host explícito: sin él Node resuelve a IPv6 y el hot file queda como http://[::1]:PORT,
        // que la CSP no puede expresar.
        host: 'localhost',
        port: {{ app.port }},
        strictPort: true,
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
    build: {
        chunkSizeWarningLimit: 1200,
    },
});
