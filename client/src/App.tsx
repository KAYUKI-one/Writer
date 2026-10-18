import { useEffect } from 'react'
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom'

import { LoginPage } from './features/auth/LoginPage'
import { WritingPage } from './features/editor/WritingPage'
import { NovelsPage } from './features/novels/NovelsPage'
import { useSyncTriggers } from './hooks/useSyncTriggers'
import { useSession } from './stores/session'

/**
 * 登录态检查。
 *
 * token 无效只影响路由，**不清 IndexedDB** —— 401 期间本地攒下的稿子
 * 会在重新登录后自动推上去。
 */
function RequireAuth() {
  const token = useSession((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

function AuthedShell() {
  // 启动同步、联网/切后台/心跳/快捷键等全部触发点集中在这里。
  // StrictMode 会挂载两次，引擎的 single-flight 保证不会并发 sync。
  useSyncTriggers()
  return <Outlet />
}

function LoginRoute() {
  const token = useSession((s) => s.token)
  return token ? <Navigate to="/" replace /> : <LoginPage />
}

function App() {
  const ready = useSession((s) => s.ready)
  const restore = useSession((s) => s.restore)

  useEffect(() => {
    if (!ready) void restore()
  }, [ready, restore])

  if (!ready) return <div className="boot" />

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<RequireAuth />}>
          <Route element={<AuthedShell />}>
            <Route index element={<NovelsPage />} />
            <Route path="novel/:novelId" element={<WritingPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
