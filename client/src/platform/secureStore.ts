import { isElectron } from './index'

export interface TokenStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}

const TOKEN_KEY = 'writer.token'

/**
 * 浏览器：localStorage。
 *
 * 不用 Cookie —— Bearer token 让三个端（web / Electron app:// / Capacitor
 * https://localhost）行为完全一致，也让 CORS 变简单：不发送凭据，
 * allow_credentials=False 时连 CSRF 都不存在。
 */
const webStore: TokenStore = {
  async get() {
    return localStorage.getItem(TOKEN_KEY)
  },
  async set(token: string) {
    localStorage.setItem(TOKEN_KEY, token)
  },
  async clear() {
    localStorage.removeItem(TOKEN_KEY)
  },
}

/**
 * Electron：走主进程的 safeStorage（Windows 上绑 DPAPI，绑当前用户账户），
 * 渲染进程拿不到明文文件。这是 Electron 内置能力，零额外依赖。
 */
const electronStore: TokenStore = {
  async get() {
    return window.writerBridge?.tokenStore.get() ?? null
  },
  async set(token: string) {
    await window.writerBridge?.tokenStore.set(token)
  },
  async clear() {
    await window.writerBridge?.tokenStore.clear()
  },
}

export const tokenStore: TokenStore = isElectron ? electronStore : webStore
