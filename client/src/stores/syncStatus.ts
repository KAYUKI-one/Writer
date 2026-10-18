import { create } from 'zustand'

import { countConflicts, countDirty } from '../db/repo.chapters'

export type SyncState =
  | 'idle' // 无待同步改动
  | 'pending' // 有本地改动待推送
  | 'syncing'
  | 'offline' // 网络不通
  | 'error' // 服务端报错
  | 'conflict' // 有未解决的冲突
  | 'need_login'

interface SyncStatusState {
  state: SyncState
  dirtyCount: number
  conflictCount: number
  lastSyncAt: number
  errorMessage: string | null
  retryCount: number
  /** 重新从 IndexedDB 统计 dirty / 冲突数。 */
  refresh: () => Promise<void>
}

export const useSyncStatus = create<SyncStatusState>((set, get) => ({
  state: 'idle',
  dirtyCount: 0,
  conflictCount: 0,
  lastSyncAt: 0,
  errorMessage: null,
  retryCount: 0,

  async refresh() {
    const [dirtyCount, conflictCount] = await Promise.all([countDirty(), countConflicts()])
    const next: Partial<SyncStatusState> = { dirtyCount, conflictCount }

    // 冲突优先展示，其次才是同步进度 —— 冲突需要用户动手，别的只是等待
    const current = get().state
    if (conflictCount > 0) {
      next.state = 'conflict'
    } else if (current === 'conflict') {
      next.state = dirtyCount > 0 ? 'pending' : 'idle'
    } else if (current === 'syncing' || current === 'offline' || current === 'error' || current === 'need_login') {
      // 这些状态由引擎自己维护，不要被统计覆盖
    } else {
      next.state = dirtyCount > 0 ? 'pending' : 'idle'
    }

    set(next)
  },
}))
