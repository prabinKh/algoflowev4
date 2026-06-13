import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: !isProduction,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('three') || id.includes('@react-three')) return 'three';
            if (id.includes('gsap') || id.includes('/motion')) return 'animation';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('@tanstack')) return 'query';
            if (
              id.includes('react-dom') ||
              id.includes('react-router') ||
              id.includes('/react/')
            ) {
              return 'react';
            }

            return 'vendor';
          },
        },
      },
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      hmr: false,
      watch: null,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
      },
    },
  };
});
