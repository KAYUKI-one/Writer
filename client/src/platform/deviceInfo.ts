import { newId } from '../lib/id'
import { platform } from './index'

const DEVICE_ID_KEY = 'writer.device_id'
const DEVICE_NAME_KEY = 'writer.device_name'

/**
 * 设备标识。**必须持久且稳定** —— token 里签了签发时的设备 id，
 * 同步请求也要带它。一旦变了就得重新登录。
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = newId()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

function guessDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

  if (platform === 'electron') {
    return /windows/i.test(ua) ? 'Windows 桌面端' : '桌面端'
  }
  if (platform === 'android') return '安卓手机'
  if (platform === 'ios') return 'iPhone'

  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /chrome/i.test(ua)
      ? 'Chrome'
      : /firefox/i.test(ua)
        ? 'Firefox'
        : /safari/i.test(ua)
          ? 'Safari'
          : '浏览器'
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /mac os/i.test(ua)
      ? 'macOS'
      : /android/i.test(ua)
        ? 'Android'
        : /linux/i.test(ua)
          ? 'Linux'
          : ''
  return os ? `${browser} · ${os}` : browser
}

/** 冲突副本的标题里会写上这个名字，所以要能让人一眼认出是哪台设备。 */
export function getDeviceName(): string {
  return localStorage.getItem(DEVICE_NAME_KEY) || guessDeviceName()
}

export function setDeviceName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name)
}
