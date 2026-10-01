const { contextBridge, ipcRenderer } = require('electron');

/**
 * 渲染进程唯一能碰到的主进程能力：把一次 HTTP 请求交给主进程发出。
 * 只暴露这一个通道，不暴露 ipcRenderer 本身，也不开 nodeIntegration。
 */
contextBridge.exposeInMainWorld('senseDesktop', {
  request: (options) => ipcRenderer.invoke('sense:http', options),
  abort: (id) => ipcRenderer.send('sense:http-abort', id),
});
