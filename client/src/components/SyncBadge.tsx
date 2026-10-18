import { useState } from 'react'

import { useSyncStatus } from '../stores/syncStatus'
import { describeSync } from '../sync/status'
import { SyncPanel } from './SyncPanel'

/**
 * 右下角 12px 圆点 + 一行短文字。唯一常驻的同步控件，不打扰写作。
 * 点击展开面板。
 */
export function SyncBadge() {
  const [open, setOpen] = useState(false)

  const state = useSyncStatus((s) => s.state)
  const dirtyCount = useSyncStatus((s) => s.dirtyCount)
  const retryCount = useSyncStatus((s) => s.retryCount)
  const lastSyncAt = useSyncStatus((s) => s.lastSyncAt)

  const view = describeSync(state, dirtyCount, retryCount, lastSyncAt)

  return (
    <>
      <button
        type="button"
        className="sync-badge"
        onClick={() => setOpen((v) => !v)}
        title="同步状态"
      >
        <span className={`status-dot ${view.tone}`} />
        <span className="sync-badge-label">{view.label}</span>
      </button>
      {open && <SyncPanel onClose={() => setOpen(false)} />}
    </>
  )
}
