import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 相对资源路径：同一份 dist 既由 nginx 提供，也能被 Electron 的 app:// 加载。
  // 路由用 HashRouter，避免 file:// / app:// 下 History API 的路径问题。
  base: './',
})
