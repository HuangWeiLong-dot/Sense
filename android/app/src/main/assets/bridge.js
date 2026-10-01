/**
 * Android 宿主注入的桥接垫片。
 *
 * TS 侧只认 window.senseDesktop（与 Electron 桌面壳完全同一套接口），
 * 这里把「原生 JS 接口 + 回调」包装成 Promise —— 前端代码一行都不用改。
 * 于是移动端和桌面端共用同一份 dist/ 产物、同一个 postJson 分支。
 */
(function () {
  var pending = Object.create(null);

  window.senseDesktop = {
    request: function (options) {
      return new Promise(function (resolve, reject) {
        pending[options.id] = { resolve: resolve, reject: reject };
        window.SenseNative.request(JSON.stringify(options));
      });
    },
    abort: function (id) {
      window.SenseNative.abort(String(id));
    },
  };

  // 由原生侧回调（evaluateJavascript）
  window.__senseBridgeResolve = function (id, payload) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    try {
      entry.resolve(JSON.parse(payload));
    } catch (err) {
      entry.reject(new Error('桥接返回的不是合法 JSON'));
    }
  };

  window.__senseBridgeReject = function (id, message) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    entry.reject(new Error(message));
  };
})();
