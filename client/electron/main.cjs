/**
 * Electron 主进程。
 *
 * 页面用自定义 app:// 协议加载，而不是 file:// —— 这样渲染进程有一个
 * 稳定的源（app://writer），localStorage / IndexedDB 不会因为安装路径变化
 * 而丢失，Web Crypto 也处于安全上下文里。
 *
 * 网络请求仍然全部由渲染进程里的 SyncEngine 发起，主进程只做三件事：
 * 提供静态文件、加密存 token、把外部链接交给系统浏览器。
 */

const { app, BrowserWindow, ipcMain, Menu, net, protocol, safeStorage, shell } =
  require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const APP_SCHEME = 'app'
const APP_HOST = 'writer'
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

const DIST_DIR = path.join(__dirname, '..', 'dist')
const DEV_URL = process.env.VITE_DEV_SERVER_URL

// 测试时用临时 userData，避免读到上一轮的 token / IndexedDB
if (process.env.WRITER_USER_DATA_DIR) {
  app.setPath('userData', process.env.WRITER_USER_DATA_DIR)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ---------------------------------------------------------------- token 存储

function tokenFile() {
  return path.join(app.getPath('userData'), 'token.bin')
}

async function readToken() {
  try {
    const raw = await fs.readFile(tokenFile(), 'utf8')
    if (raw.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
    }
    if (raw.startsWith('raw:')) return raw.slice(4)
    return null
  } catch {
    return null
  }
}

async function writeToken(token) {
  const file = tokenFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  // Windows 上 safeStorage 走 DPAPI，密文只对当前用户可解。
  // 极端情况下系统不支持加密时退回明文，但绝不上传或外泄。
  const payload = safeStorage.isEncryptionAvailable()
    ? `enc:${safeStorage.encryptString(token).toString('base64')}`
    : `raw:${token}`
  await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 })
}

async function clearToken() {
  await fs.rm(tokenFile(), { force: true })
}

function registerTokenIpc() {
  ipcMain.handle('writer:token-get', () => readToken())
  ipcMain.handle('writer:token-set', async (_event, token) => {
    if (typeof token !== 'string' || !token) return
    await writeToken(token)
  })
  ipcMain.handle('writer:token-clear', () => clearToken())
}

// ------------------------------------------------------------ 静态文件协议

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 })
    }

    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'

    const filePath = path.normalize(path.join(DIST_DIR, pathname))
    const inside = filePath === DIST_DIR || filePath.startsWith(DIST_DIR + path.sep)
    if (!inside) return new Response('Not found', { status: 404 })

    try {
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// ------------------------------------------------------------------ 窗口

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 420,
    minHeight: 540,
    show: false,
    title: '写作',
    backgroundColor: '#fbfaf7',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 打包后自检：加载首页、确认 preload 桥和登录表单都在，然后退出。
  if (process.env.WRITER_SMOKE_TEST) {
    const timer = setTimeout(() => {
      console.error('SMOKE_TIMEOUT')
      app.exit(1)
    }, 20_000)

    win.webContents.once('did-finish-load', async () => {
      try {
        // 等 React 的 restore() 跑完（没有 token 时是一次 IPC 往返）
        const result = await win.webContents.executeJavaScript(`(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200))
          return {
            title: document.title,
            hasAuth: !!document.querySelector('.auth-card'),
            bridge: !!window.writerBridge,
            href: location.href,
          }
        })()`)
        console.log('SMOKE_RESULT', JSON.stringify(result))
        clearTimeout(timer)
        app.exit(result.hasAuth && result.bridge ? 0 : 1)
      } catch (error) {
        console.error('SMOKE_ERROR', error)
        clearTimeout(timer)
        app.exit(1)
      }
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_ORIGIN)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (DEV_URL) {
    void win.loadURL(DEV_URL)
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.setAppUserModelId('com.kleintraveler.writer')

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerTokenIpc()
    registerAppProtocol()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
