/**
 * Vite 配置
 * 企业实践：开发环境配置 API 代理（避免 CORS 问题），生产环境使用 Express 托管静态文件
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 将 /api 请求代理到后端 Express 服务器
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // WebSocket 代理
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
