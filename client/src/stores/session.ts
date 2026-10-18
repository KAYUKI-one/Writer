import { create } from 'zustand'

import { fetchMe, type TokenResponse } from '../api/auth'
import { ApiError } from '../api/client'
import { wipeLocalData } from '../db/db'
import { getStoredUserId, setStoredUserId } from '../db/meta'
import { tokenStore } from '../platform/secureStore'

const USERNAME_KEY = 'writer.username'

interface SessionState {
  /** 是否已尝试从存储里恢复过登录态。false 时不要渲染路由。 */
  ready: boolean
  token: string | null
  userId: string | null
  username: string | null
  restore: () => Promise<void>
  signIn: (resp: TokenResponse) => Promise<void>
  signOut: (options?: { wipe?: boolean }) => Promise<void>
}

export const useSession = create<SessionState>((set) => ({
  ready: false,
  token: null,
  userId: null,
  username: null,

  async restore() {
    const token = await tokenStore.get()
    const storedUserId = await getStoredUserId()

    if (!token || !storedUserId) {
      set({ ready: true })
      return
    }

    try {
      const me = await fetchMe()
      await setStoredUserId(me.user_id)
      localStorage.setItem(USERNAME_KEY, me.username)
      set({ ready: true, token, userId: me.user_id, username: me.username })
    } catch (error) {
      if (error instanceof ApiError && error.isNetwork) {
        // **离线启动不能把人踢下线。** token 和 IndexedDB 都还在，
        // 先按已登录状态渲染；等网络恢复后的同步会验证 token。
        set({
          ready: true,
          token,
          userId: storedUserId,
          username: localStorage.getItem(USERNAME_KEY),
        })
        return
      }
      // 服务端明确说 token 失效（401）才丢掉它，但**绝不清 IndexedDB** ——
      // 本地可能还有没同步上去的稿子，登录后要能接着推。
      await tokenStore.clear()
      set({ ready: true, token: null, userId: null, username: null })
    }
  },

  async signIn(resp) {
    const storedUserId = await getStoredUserId()
    if (storedUserId && storedUserId !== resp.user_id) {
      // 换账号了。不清库会串数据 —— A 的小说出现在 B 的列表里。
      await wipeLocalData()
    }
    await setStoredUserId(resp.user_id)
    await tokenStore.set(resp.token)
    localStorage.setItem(USERNAME_KEY, resp.username)
    set({ token: resp.token, userId: resp.user_id, username: resp.username })
  },

  async signOut(options) {
    if (options?.wipe) {
      await wipeLocalData()
      await setStoredUserId(null)
    }
    await tokenStore.clear()
    localStorage.removeItem(USERNAME_KEY)
    set({ token: null, userId: null, username: null })
  },
}))
