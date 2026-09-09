import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { makeOffline } from "vite-plugin-make-offline";

export default defineConfig({
  plugins: [react(), makeOffline()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
  server: {
    open: 'index.html',
  },
});