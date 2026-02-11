import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    server: {
        host: '0.0.0.0', // Listen on all network interfaces
        port: 5173,
        scale: true, // Allow fallback ports if 5173 is busy? No, stick to strict or let it pick.
        strictPort: false, // Let it pick another port if busy, but clientPort might mismatch then. Let's keep default.
        cors: true, // Enable CORS
        hmr: {
            clientPort: 5173 // Force client to connect to this port (useful if behind proxy or just to be sure)
        },
        watch: {
            ignored: ['**/hotspots.json']  // Don't reload when hotspots.json changes
        }
    },
    plugins: []
});
