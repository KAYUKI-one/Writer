import { getDeviceId } from '../platform/deviceInfo'
import { tokenStore } from '../platform/secureStore'

/**
 * 服务器地址。
 *
 * 网页端可以是同源相对路径；Electron 的 app:// 与 Capacitor 的
 * http://localhost 没有可用的同源后端，必须在登录页（或同步面板）里
 * 填一个绝对地址。地址存在 localStorage，安装包只构建一次就能换服务器。
 */
const BUILD_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
const API_BASE_KEY = 'writer.api_base'

let runtimeBase: string | null = null

/** 省略协议时按 https 处理；末尾斜杠统一去掉。 */
export function normalizeApiBase(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed.replace(/^\/+/, '')}`
}

export function isValidApiBase(value: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function getApiBase(): string {
  if (runtimeBase === null) {
    let stored = ''
    try {
      stored = localStorage.getItem(API_BASE_KEY) ?? ''
    } catch {
      // 隐私模式等场景拿不到 localStorage，退回构建时的地址
    }
    runtimeBase = stored || BUILD_BASE
  }
  return runtimeBase ?? BUILD_BASE
}

/** 传空字符串表示恢复构建时的默认地址。 */
export function setApiBase(value: string): void {
  const normalized = normalizeApiBase(value)
  runtimeBase = normalized || BUILD_BASE
  try {
    if (normalized) localStorage.setItem(API_BASE_KEY, normalized)
    else localStorage.removeItem(API_BASE_KEY)
  } catch {
    // 存不下就只在本次运行生效
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** 连不上服务器（不是服务器返回了错误）。 */
  get isNetwork(): boolean {
    return this.status === 0
  }

  get isAuth(): boolean {
    return this.status === 401
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  /** 不需要 Authorization 头（登录、注册、健康检查）。 */
  anonymous?: boolean
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 30_000, anonymous = false } = opts

  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (!anonymous) {
    const token = await tokenStore.get()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    // 网络层失败（离线、超时、DNS）。用 status 0 区别于服务端返回的错误，
    // 因为这两者的重试策略完全不同。
    throw new ApiError(0, 'network_error', '无法连接服务器')
  } finally {
    clearTimeout(timer)
  }

  if (resp.status === 204) return undefined as T

  const text = await resp.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!resp.ok) {
    const detail = payload as { code?: string; message?: string } | null
    throw new ApiError(
      resp.status,
      detail?.code ?? `http_${resp.status}`,
      detail?.message ?? resp.statusText ?? '请求失败',
    )
  }

  return payload as T
}
