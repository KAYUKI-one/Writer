import { useEffect } from 'react'

import { flushAll } from '../lib/flushRegistry'
import { useSyncStatus } from '../stores/syncStatus'
import { requestSync } from '../sync/engine'

/** 后台超过这么久，回到前台时主动拉一次别人的改动。 */
const REFOCUS_SYNC_AFTER_MS = 60_000
/** 兜底轮询。事件漏触发时也能收敛。 */
const HEARTBEAT_MS = 60_000
const HEARTBEAT_STALE_MS = 5 * 60_000

/**
 * 把所有「该同步一下」的时机集中在一处。
 *
 * 落盘（flush）永远在同步之前：网络可以失败，本地那一步必须做完。
 * 所有触发最终都进 SyncEngine 的 single-flight，重复触发是安全的。
 */
export function useSyncTriggers(): void {
  useEffect(() => {
    let hiddenAt: number | null = null

    void useSyncStatus.getState().refresh()
    void requestSync('startup')

    const onOnline = () => void requestSync('online')

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        // keepalive 的请求体上限只有 ~64KB，落盘才是可靠的那一步
        void flushAll().then(() => requestSync('hidden'))
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > REFOCUS_SYNC_AFTER_MS) {
        hiddenAt = null
        void requestSync('refocus')
      }
    }

    const onPageHide = () => {
      void flushAll()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // 中文输入法组词期间不响应快捷键
      if (event.isComposing) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void flushAll().then(() => requestSync('manual'))
    }

    const timer = window.setInterval(() => {
      const { dirtyCount, lastSyncAt } = useSyncStatus.getState()
      if (dirtyCount > 0 || Date.now() - lastSyncAt > HEARTBEAT_STALE_MS) {
        void requestSync('heartbeat')
      }
    }, HEARTBEAT_MS)

    window.addEventListener('online', onOnline)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
