const electron = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// 若环境里带着 ELECTRON_RUN_AS_NODE=1，Electron 会退化成纯 Node，
// require('electron') 只返回可执行文件路径，后面会在 ipcMain 上莫名其妙地崩。
if (typeof electron === 'string' || !electron.app) {
  console.error(
    'Electron 没有以应用模式启动（require("electron") 返回的不是应用模块）。\n' +
      '通常是环境变量 ELECTRON_RUN_AS_NODE 被设置了，请取消后再运行：\n' +
      '  PowerShell:  Remove-Item Env:ELECTRON_RUN_AS_NODE\n' +
      '  cmd:         set ELECTRON_RUN_AS_NODE=\n',
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, shell } = electron;
const { forwardRequest } = require('./httpForward.cjs');

/**
 * Sense 桌面壳（Windows / Electron）。
 *
 * 为什么桌面壳不只是「套个浏览器」：网页里的 fetch 受 CORS 约束，第三方模型 API
 * 不返回 Access-Control-Allow-Origin 就永远拿不到响应，连预检都可能被 400 拒掉。
 * 桌面壳把 API 请求改从**主进程**发出（Node 侧没有 CORS 概念），于是：
 *   - 不需要 `npm run proxy` 本机代理；
 *   - 不需要给 webview 关掉 webSecurity（那会牺牲同源策略）。
 * 渲染进程仍然用 contextIsolation + sandbox，只通过 preload 暴露这一个受限通道。
 *
 * 开发：npm run desktop:dev（窗口指向 vite dev server）
 * 生产：npm run desktop（会先 npm run build，再加载 dist/）
 */

/** --dev-url=http://localhost:5173 让窗口指向 dev server */
function devUrlFromArgv() {
  const arg = process.argv.find((a) => a.startsWith('--dev-url='));
  return arg ? arg.slice('--dev-url='.length) : '';
}

/** 正在进行中的请求，用于支持结果页/分析页的「取消」 */
const inflight = new Map();

ipcMain.handle('sense:http', async (_event, options) => {
  const controller = new AbortController();
  inflight.set(options.id, controller);
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60_000);

  try {
    return await forwardRequest(options, controller);
  } finally {
    clearTimeout(timer);
    inflight.delete(options.id);
  }
});

ipcMain.on('sense:http-abort', (_event, id) => {
  inflight.get(id)?.abort();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    title: 'Sense',
    backgroundColor: '#fff6fa',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 外链交给系统浏览器，不在应用窗口里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = devUrlFromArgv();
  const builtEntry = path.join(__dirname, '..', 'dist', 'index.html');

  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(builtEntry)) {
    void win.loadFile(builtEntry);
  } else {
    console.warn('dist/ 不存在，回退到 http://localhost:5173（先运行 npm run build 或 npm run dev）');
    void win.loadURL('http://localhost:5173');
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
