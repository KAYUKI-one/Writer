import { formatRelative } from '../lib/time'
import type { SyncState } from '../stores/syncStatus'

export type StatusTone = 'ok' | 'busy' | 'warn' | 'error'

export interface StatusView {
  label: string
  tone: StatusTone
}

/**
 * 徽标文案。
 *
 * 判定不只看 navigator.onLine（它经常撒谎），而是以真实请求结果为准 ——
 * 引擎在收到网络错误时才会把状态置为 offline。
 */
export function describeSync(
  state: SyncState,
  dirtyCount: number,
  retryCount: number,
  lastSyncAt: number,
): StatusView {
  switch (state) {
    case 'syncing':
      return { label: '同步中…', tone: 'busy' }
    case 'offline':
      return { label: `离线 · ${dirtyCount} 处待同步`, tone: 'warn' }
    case 'error':
      return { label: `同步失败 · 重试中 (${retryCount}/8)`, tone: 'error' }
    case 'conflict':
      return { label: '有冲突待处理', tone: 'warn' }
    case 'need_login':
      return { label: `未登录 · 本地有 ${dirtyCount} 处改动`, tone: 'error' }
    case 'pending':
      return { label: `待同步 · ${dirtyCount} 处`, tone: 'busy' }
    case 'idle':
      return {
        label: lastSyncAt ? `已同步 · ${formatRelative(lastSyncAt)}` : '已同步',
        tone: 'ok',
      }
  }
}
