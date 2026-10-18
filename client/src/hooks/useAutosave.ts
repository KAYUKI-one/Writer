import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { saveChapterContent, saveChapterTitle } from '../db/repo.chapters'
import { debounceMax, type Debounced } from '../lib/debounce'
import { registerFlusher } from '../lib/flushRegistry'

/** 停笔 1.2s 落盘；持续打字时最多 5s 也必须落一次。 */
const SAVE_DEBOUNCE_MS = 1_200
const SAVE_MAX_WAIT_MS = 5_000

export interface AutosaveHandle {
  /** 有新的编辑时调用。 */
  schedule: () => void
  /** 立刻落盘（Ctrl+S、切后台、点同步）。 */
  flush: () => Promise<void>
  /** 取消待触发的落盘（如中文输入法组词期间）。 */
  cancel: () => void
  lastSavedAt: number
  saving: boolean
}

interface Draft {
  title: string
  content: string
}

/**
 * 编辑器的本地落盘。
 *
 * 只写 IndexedDB，不碰网络 —— 推送由 3s 后的 SyncEngine 触发。
 * 组件卸载时会自动 flush 一次，切章节不丢最后几个字。
 */
export function useAutosave(
  chapterId: string,
  read: () => Draft,
  onSaved?: (draft: Draft) => void,
): AutosaveHandle {
  const readRef = useRef(read)
  const onSavedRef = useRef(onSaved)

  // 每次渲染后同步最新回调；不在渲染期写 ref，避免 React 19 的 lint 告警
  useEffect(() => {
    readRef.current = read
    onSavedRef.current = onSaved
  })

  const [lastSavedAt, setLastSavedAt] = useState(() => Date.now())
  const [saving, setSaving] = useState(false)
  const running = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)

  const flush = useCallback(async () => {
    // 串行化写入：上一次还没落完时先等它，避免两次写交错推进 local_seq
    if (running.current) await running.current

    const draft = readRef.current()
    const task = (async () => {
      if (mounted.current) setSaving(true)
      try {
        // 先标题后正文：两者都只是各自的字段更新，顺序不影响正确性
        await saveChapterTitle(chapterId, draft.title)
        await saveChapterContent(chapterId, draft.content)
        if (mounted.current) setLastSavedAt(Date.now())
        onSavedRef.current?.(draft)
      } finally {
        if (mounted.current) setSaving(false)
      }
    })()

    running.current = task
    try {
      await task
    } finally {
      if (running.current === task) running.current = null
    }
  }, [chapterId])

  // 防抖器只建一次；通过 ref 调用最新的 flush，避免 useMemo 依赖带动重建
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })

  const trigger = useCallback(() => {
    void flushRef.current()
  }, [])

  const debounced = useMemo<Debounced<[]>>(
    // oxlint-disable-next-line react/refs -- 闭包只在防抖触发时执行，不在渲染期读 ref
    () => debounceMax(trigger, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS),
    [trigger],
  )

  useEffect(() => {
    mounted.current = true
    const unregister = registerFlusher(() => debounced.flush())

    return () => {
      mounted.current = false
      // 卸载（切章节 / 离开页面）前把内存里的字落下去
      debounced.flush()
      debounced.cancel()
      unregister()
    }
  }, [debounced])

  const schedule = useCallback(() => debounced(), [debounced])
  const cancel = useCallback(() => debounced.cancel(), [debounced])
  const flushNow = useCallback(async () => {
    debounced.cancel()
    await flush()
  }, [debounced, flush])

  return { schedule, flush: flushNow, cancel, lastSavedAt, saving }
}
