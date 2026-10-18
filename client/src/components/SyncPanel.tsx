import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  getApiBase,
  isValidApiBase,
  normalizeApiBase,
  setApiBase,
} from '../api/client'
import { countDirty, listPushErrors } from '../db/repo.chapters'
import { flushAll } from '../lib/flushRegistry'
import { formatRelative } from '../lib/time'
import { useDataVersion } from '../stores/dataVersion'
import { useSession } from '../stores/session'
import { useSyncStatus } from '../stores/syncStatus'
import { requestSync } from '../sync/engine'
import { describeSync } from '../sync/status'

interface SyncPanelProps {
  onClose: () => void
}

export function SyncPanel({ onClose }: SyncPanelProps) {
  const navigate = useNavigate()
  const version = useDataVersion((s) => s.version)
  const signOut = useSession((s) => s.signOut)
  const username = useSession((s) => s.username)

  const state = useSyncStatus((s) => s.state)
  const dirtyCount = useSyncStatus((s) => s.dirtyCount)
  const conflictCount = useSyncStatus((s) => s.conflictCount)
  const retryCount = useSyncStatus((s) => s.retryCount)
  const errorMessage = useSyncStatus((s) => s.errorMessage)
  const lastSyncAt = useSyncStatus((s) => s.lastSyncAt)

  const [errors, setErrors] = useState<{ id: string; title: string; error: string }[]>([])
  const [syncing, setSyncing] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [serverDraft, setServerDraft] = useState(() => getApiBase())
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    void useSyncStatus.getState().refresh()
    void listPushErrors().then(setErrors)
  }, [version])

  const view = describeSync(state, dirtyCount, retryCount, lastSyncAt)

  async function syncNow() {
    setSyncing(true)
    try {
      await flushAll()
      await requestSync('manual-panel')
      setErrors(await listPushErrors())
    } finally {
      setSyncing(false)
    }
  }

  async function relogin() {
    if (!window.confirm('登录已失效，本机稿件会保留。重新登录后自动上传，继续吗？')) return
    // 不清 IndexedDB：本地可能还有没推上去的稿子
    await signOut()
    navigate('/login', { replace: true })
  }

  async function saveServer() {
    const normalized = normalizeApiBase(serverDraft)
    if (!isValidApiBase(normalized)) {
      setServerError('地址格式不正确，例如 https://writer.example.com')
      return
    }
    if (normalized === getApiBase()) {
      setServerOpen(false)
      return
    }
    if (
      !window.confirm(
        '更换服务器后需要重新登录。本机未同步的修改会保留，但可能被上传到新服务器。继续吗？',
      )
    ) {
      return
    }
    setApiBase(normalized)
    // 只清 token，不清 IndexedDB —— 本机的字还在
    await signOut()
    navigate('/login', { replace: true })
  }

  async function logout() {
    const dirty = await countDirty()
    const warning =
      dirty > 0
        ? `本机还有 ${dirty} 处未同步的修改。退出会清除本地数据，这些内容将丢失。\n\n建议先联网同步。仍要退出吗？`
        : '退出后本机缓存会被清除，下次登录会从服务器重新拉取。确定退出？'
    if (!window.confirm(warning)) return
    await signOut({ wipe: true })
    navigate('/login', { replace: true })
  }

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="sync-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span className={`status-dot ${view.tone}`} />
          <strong>{view.label}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <dl className="panel-stats">
          <div>
            <dt>待同步</dt>
            <dd>{dirtyCount} 处</dd>
          </div>
          <div>
            <dt>未解决冲突</dt>
            <dd>{conflictCount} 处</dd>
          </div>
          <div>
            <dt>上次同步</dt>
            <dd>{lastSyncAt ? formatRelative(lastSyncAt) : '从未'}</dd>
          </div>
        </dl>

        <div className="panel-server">
          <p className="panel-section-title">服务器</p>
          {serverOpen ? (
            <div className="server-row">
              <input
                className="text-input"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={serverDraft}
                onChange={(e) => setServerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveServer()
                  if (e.key === 'Escape') setServerOpen(false)
                }}
                autoFocus
              />
              <button type="button" className="ghost-button" onClick={() => void saveServer()}>
                保存
              </button>
            </div>
          ) : (
            <div className="server-row">
              <span className="server-address">{getApiBase() || '同源（网页端）'}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setServerDraft(getApiBase())
                  setServerError(null)
                  setServerOpen(true)
                }}
              >
                修改
              </button>
            </div>
          )}
          {serverError && <p className="panel-error">{serverError}</p>}
        </div>

        {errorMessage && <p className="panel-error">{errorMessage}</p>}

        {errors.length > 0 && (
          <div className="panel-errors">
            <p className="panel-section-title">推送失败的记录</p>
            <ul>
              {errors.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong>
                  <span>{e.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {state === 'need_login' ? (
          <button type="button" className="primary-button" onClick={() => void relogin()}>
            重新登录
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={() => void syncNow()}
            disabled={syncing}
          >
            {syncing ? '同步中…' : '立即同步'}
          </button>
        )}

        <div className="panel-footer">
          <span className="panel-account">{username ? `已登录：${username}` : '已登录'}</span>
          <button type="button" className="link-button danger" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </div>
    </div>
  )
}
