import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:5178' } },
  // 고정 파일명: 재빌드해도 dist에 옛 파일이 쌓이지 않도록 (서버가 no-store로 서빙)
  build: { rollupOptions: { output: { entryFileNames: 'assets/app.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/app[extname]' } } },
});
