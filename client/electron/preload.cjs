const { contextBridge, ipcRenderer } = require('electron')

/**
 * 渲染进程唯一能看到的主进程能力。
 * 不暴露 ipcRenderer 本体，页面代码拿不到任意 channel。
 */
contextBridge.exposeInMainWorld('writerBridge', {
  platform: process.platform,
  tokenStore: {
    get: () => ipcRenderer.invoke('writer:token-get'),
    set: (token) => ipcRenderer.invoke('writer:token-set', token),
    clear: () => ipcRenderer.invoke('writer:token-clear'),
  },
})
