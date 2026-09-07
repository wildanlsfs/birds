import { defineConfig } from 'vite';

export default defineConfig({
  base: '/birds/',
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'vendor-three';
          }
          if (id.includes('node_modules/@mediapipe/tasks-vision')) {
            return 'vendor-mediapipe';
          }
        }
      }
    }
  }
});
