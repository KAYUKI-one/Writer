import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { login, register } from '../../api/auth'
import {
  ApiError,
  getApiBase,
  isValidApiBase,
  normalizeApiBase,
  setApiBase,
} from '../../api/client'
import { countDirty } from '../../db/repo.chapters'
import { needsServerSetup } from '../../platform'
import { useSession } from '../../stores/session'
import { requestSync } from '../../sync/engine'

export function LoginPage() {
  const navigate = useNavigate()
  const signIn = useSession((s) => s.signIn)

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState(() => getApiBase())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(0)

  useEffect(() => {
    void countDirty().then(setDirty)
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)

    if (needsServerSetup) {
      const normalized = normalizeApiBase(server)
      if (!isValidApiBase(normalized)) {
        setError('请填写服务器地址，例如 https://writer.example.com')
        return
      }
      setApiBase(normalized)
      setServer(normalized)
    }

    setBusy(true)
    try {
      const resp = mode === 'login' ? await login(username, password) : await register(username, password)
      await signIn(resp)
      // 本地可能有 401 期间攒下的稿子，登录后立刻推上去
      void requestSync('signin')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <h1 className="auth-title">写作</h1>
        <p className="auth-subtitle">一个安静写字的地方</p>

        {dirty > 0 && (
          <p className="auth-note">本机有 {dirty} 处未同步的修改，登录后会自动上传。</p>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          {needsServerSetup && (
            <label className="field">
              <span className="field-label">服务器地址</span>
              <input
                className="text-input"
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://writer.example.com"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                autoFocus
              />
              <span className="field-hint">
                自己的服务器地址；也支持 http://192.168.1.10:8000 这样的局域网地址。
              </span>
            </label>
          )}

          <label className="field">
            <span className="field-label">用户名</span>
            <input
              className="text-input"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!needsServerSetup}
            />
          </label>

          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="text-input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="primary-button" type="submit" disabled={busy || !username || !password}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
        </button>

        <p className="auth-hint">
          {mode === 'register' ? '密码至少 8 位；用户名 2–32 位中文、字母、数字或下划线。' : '断网也能写，联网后自动同步。'}
        </p>
      </div>
    </main>
  )
}
