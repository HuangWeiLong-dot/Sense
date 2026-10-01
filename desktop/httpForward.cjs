/**
 * 主进程里的单次请求转发。
 *
 * 抽成独立模块有两个原因：
 *  1. main.cjs 只留窗口与 IPC 接线，逻辑一目了然；
 *  2. 这段逻辑不需要启动 Electron 就能单测（见 src/adapters/desktop.test.ts）。
 *
 * Node 侧没有 CORS 概念，所以这里不需要对方返回 Access-Control-Allow-Origin，
 * 这正是桌面版可以不要本机代理的原因。
 */

/**
 * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: string }} options
 * @param {AbortController} controller
 * @returns {Promise<{ status: number, statusText: string, text: string }>}
 */
async function forwardRequest(options, controller = new AbortController()) {
  try {
    const response = await fetch(options.url, {
      method: options.method || 'POST',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      text: await response.text(),
    };
  } catch (err) {
    // 与浏览器 AbortError 对齐措辞，渲染进程靠 /abort/i 识别「已取消」
    if (controller.signal.aborted) throw new Error('Aborted: 请求已取消或超时');
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`网络请求失败：${message}`);
  }
}

module.exports = { forwardRequest };
