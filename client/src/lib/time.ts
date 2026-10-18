/**
 * 时间显示。
 *
 * 所有绝对时间都用**服务器时钟**（本地时间 + 每次同步记录下来的偏移量）。
 * 用户把手机时间设错也不影响任何数据正确性，只是显示上仍然正确。
 */

let serverOffsetMs = 0

export function setServerOffset(offsetMs: number): void {
  serverOffsetMs = offsetMs
}

export function getServerOffset(): number {
  return serverOffsetMs
}

/** 当前服务器时间。 */
export function serverNow(): number {
  return Date.now() + serverOffsetMs
}

export function formatRelative(ms: number): string {
  if (!ms) return '从未'
  const diff = serverNow() - ms
  if (diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return '刚刚'
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return formatDate(ms)
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${formatDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
