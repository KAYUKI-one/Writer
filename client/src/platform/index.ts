/**
 * 平台判定。所有平台差异都收口在 platform/ 目录里，
 * 其余代码只认这里导出的抽象，不直接碰 Electron / Capacitor 的 API。
 */

import { Capacitor } from '@capacitor/core'

interface WriterBridge {
  platform: string
  tokenStore: {
    get(): Promise<string | null>
    set(token: string): Promise<void>
    clear(): Promise<void>
  }
}

declare global {
  interface Window {
    writerBridge?: WriterBridge
  }
}

export const isElectron =
  typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)

export const isCapacitor = Capacitor.isNativePlatform()

export type Platform = 'web' | 'electron' | 'android' | 'ios'

function detectPlatform(): Platform {
  if (isElectron) return 'electron'
  const native = Capacitor.getPlatform()
  if (native === 'android') return 'android'
  if (native === 'ios') return 'ios'
  return 'web'
}

export const platform: Platform = detectPlatform()

/** 安装包没有同源后端，必须让用户先填服务器地址。 */
export const needsServerSetup = platform !== 'web'
