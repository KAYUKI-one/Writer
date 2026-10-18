import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android 壳只负责加载同一份 dist。
 *
 * androidScheme 用 http：自建服务器常常是 http://IP:8000，页面源如果是
 * https://localhost，请求会被 WebView 当混合内容拦掉。http://localhost
 * 仍是浏览器认可的安全上下文，Web Crypto / IndexedDB 都正常。
 */
const config: CapacitorConfig = {
  appId: 'com.kleintraveler.writer',
  appName: '写作',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}

export default config
