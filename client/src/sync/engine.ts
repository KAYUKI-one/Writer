/**
 * 同步引擎 —— 全应用**唯一**碰网络的地方。
 *
 * 三条不变量：
 * 1. **single-flight**：同一时刻只允许一个 /api/sync 在飞。并发推送是重复分叉的头号来源。
 * 2. **401 绝不清 IndexedDB**。本地可能还有没推上去的稿子。
 * 3. **push 的 error 结果绝不静默丢弃**。保留 dirty 并把错误展示给用户。
 */

import { ApiError } from '../api/client'
import { callSync } from '../api/sync'
import { db } from '../db/db'
import { getCursor, setInflightOp } from '../db/meta'
import { setServerOffset } from '../lib/time'
import { tokenStore } from '../platform/secureStore'
import { useDataVersion } from '../stores/dataVersion'
import { useSession } from '../stores/session'
import { useSyncStatus } from '../stores/syncStatus'
import { applyPull } from './applyPull'
import { buildPush } from './buildPush'
import type { SyncResponse } from './types'

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]
const JITTER = 0.2
const MAX_PAGES_PER_RUN = 200

let inFlight: Promise<void> | null = null
let pendingAgain = false
let retryCount = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

export function requestSync(reason: string): Promise<void> {
  // 有手动/事件触发的同步时，取消已排期的重试，避免重复请求
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  if (inFlight) {
    pendingAgain = true
    return inFlight
  }

  inFlight = runSync(reason).finally(() => {
    inFlight = null
    if (pendingAgain) {
      pendingAgain = false
      void requestSync('queued')
    }
  })
  return inFlight
}

/** 是否正在同步。给「退出前先 flush」之类的场景用。 */
export function isSyncing(): boolean {
  return inFlight !== null
}

export async function waitForSync(): Promise<void> {
  await inFlight
}

async function runSync(reason: string): Promise<void> {
  const { token, userId } = useSession.getState()
  const status = useSyncStatus.getState()

  if (!token || !userId) {
    await status.refresh()
    useSyncStatus.setState({ state: 'need_login' })
    return
  }

  useSyncStatus.setState({ state: 'syncing', errorMessage: null })

  try {
    let pages = 0
    for (;;) {
      const cursor = await getCursor()
      const { request, pushedLocalSeq } = await buildPush(cursor)
      const resp = await callSync(request)

      // 每次同步都校准时钟偏移。客户端时钟只用于显示，权威判定全在服务端。
      setServerOffset(resp.server_time_ms - Date.now())

      await applyPull(resp, request.push)
      await ackPush(resp, pushedLocalSeq)

      if (resp.renewed_token) await tokenStore.set(resp.renewed_token)

      // 整批成功，清掉 in-flight 标记，下一批用新的 op_id
      await setInflightOp(null)

      if (!resp.has_more) break
      if (++pages > MAX_PAGES_PER_RUN) break // 防御：分页不收敛
    }

    retryCount = 0
    await status.refresh()
    const { dirtyCount, conflictCount } = useSyncStatus.getState()
    useSyncStatus.setState({
      state: conflictCount > 0 ? 'conflict' : dirtyCount > 0 ? 'pending' : 'idle',
      lastSyncAt: Date.now(),
      errorMessage: null,
      retryCount: 0,
    })
    useDataVersion.getState().bump()
  } catch (error) {
    handleError(error, reason)
  }
}

async function ackPush(
  resp: SyncResponse,
  pushedLocalSeq: Map<string, number>,
): Promise<void> {
  await db.transaction('rw', db.novels, db.chapters, async () => {
    for (const result of resp.results) {
      const table = result.entity === 'novel' ? db.novels : db.chapters
      const record = await table.get(result.id)
      if (!record) continue

      if (result.status === 'error') {
        // 绝不静默丢弃。保留 dirty=1，把错误摆到用户面前。
        await table.update(result.id, {
          pushError: result.message ?? result.code ?? '推送失败',
        })
        continue
      }

      const patch: Record<string, unknown> = {
        row_version: result.row_version,
        server_seq: result.seq,
        server_updated_at_ms: resp.server_time_ms,
        pushError: null,
      }
      if (result.status === 'conflict' && result.conflict_copy_id) {
        patch.conflict_copy_id = result.conflict_copy_id
      }

      // 推送在途期间用户又打字了 → local_seq 已经变了 → 必须保持 dirty=1。
      // 忘了这一条 = 稳定丢掉最后几秒的输入，而且极难复现。
      if (record.local_seq === pushedLocalSeq.get(result.id)) {
        patch.dirty = 0
        // 服务端确认的是「我们推上去的正文」时，旧 shadow 要么是被误存的
        // 回显，要么已经被分叉成副本 —— 留在本地只会让横幅永远消不掉。
        // title_only 是例外：服务端保留的是**它自己的**较新正文，本地这份
        // 仍是旧的，shadow 还必须留着让用户选择。
        if (result.entity === 'chapter' && result.resolution !== 'title_only') {
          patch.shadow = null
        }
      }

      await table.update(result.id, patch)
    }
  })
}

function handleError(error: unknown, reason: string): void {
  if (error instanceof ApiError && error.isAuth) {
    // 401：保留全部本地数据，只把状态切成「需要登录」。
    // **绝不能清 IndexedDB** —— 本地还有没推上去的稿子。
    useSyncStatus.setState({
      state: 'need_login',
      errorMessage: error.message,
      retryCount: 0,
    })
    return
  }

  const isNetwork = error instanceof ApiError && error.isNetwork
  const message = error instanceof Error ? error.message : '同步失败'

  if (!isNetwork) {
    console.error(`[sync] ${reason} 失败:`, error)
  }

  const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)]
  retryCount += 1

  useSyncStatus.setState({
    state: isNetwork ? 'offline' : 'error',
    errorMessage: message,
    retryCount,
  })

  // 退避到上限之后转入「仅事件驱动」，不再无休止地自动重试
  if (retryCount <= BACKOFF_MS.length) {
    scheduleRetry(delay)
  }
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer !== null) clearTimeout(retryTimer)
  const jitter = delayMs * JITTER * (Math.random() * 2 - 1)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void requestSync('retry')
  }, Math.max(500, delayMs + jitter))
}

/** 供测试和调试用。 */
export function _resetForTests(): void {
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
  inFlight = null
  pendingAgain = false
  retryCount = 0
}
