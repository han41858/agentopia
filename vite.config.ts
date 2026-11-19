import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import handler from './api/github.ts';

const github: Plugin = {
  name: 'agentopia-github',
  configureServer(server) {
    server.middlewares.use('/api/github', handler);
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/github', handler);
  },
};

export default defineConfig({
  plugins: [react(), github],
  server: { host: '0.0.0.0' },
});
