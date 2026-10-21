/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 配置。
 *
 * `server.proxy` 只在开发时把 /api 转到后端，这样前端代码里所有请求都是
 * 同源相对路径。生产同域名部署时也不需要改前端 —— 换环境变量即可。
 *
 * `/media` 与 `/api` 走同一套：关卡页的「看讲解」用 `<video src="/media/clips/<id>">`
 * （票 19）。不代理它的话，浏览器打的是 5173 上的 Vite，返回 404 —— 而 curl
 * 直接打 3001 是好的，这种「接口对、页面黑屏」最难查。视频的 Range 请求
 * 也会被代理透传（http-proxy 默认转发 Range 与 206）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // strictPort：端口被占时**直接失败**，不要自动漂到 5174/5175。
    // 漂移会让 E2E 的 baseURL 指向旧进程，测试跑过了但测的是上一版代码。
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
