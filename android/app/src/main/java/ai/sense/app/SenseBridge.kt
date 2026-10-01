package ai.sense.app

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

private const val TAG = "SenseBridge"
private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

/**
 * 渲染进程唯一能碰到的原生能力：把一次 HTTP 请求交给 OkHttp 发出。
 *
 * 与桌面版同一个思路 —— 原生侧没有 CORS 这回事，所以 Android 上同样
 * 不需要本机代理，也不必为了绕开同源策略去动 WebView 的安全设置。
 */
class SenseBridge(private val webView: WebView) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inflight = ConcurrentHashMap<String, Call>()
    private val cancelled = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .build()

    @JavascriptInterface
    fun request(payload: String) {
        val options = runCatching { JSONObject(payload) }.getOrNull()
        if (options == null) {
            Log.w(TAG, "请求参数不是合法 JSON")
            return
        }

        val id = options.optString("id")
        val url = options.optString("url")
        if (id.isEmpty() || url.isEmpty()) {
            Log.w(TAG, "请求缺少 id 或 url")
            return
        }

        scope.launch {
            try {
                val body = options.optString("body", "{}")
                val builder = Request.Builder().url(url).post(body.toRequestBody(JSON_MEDIA))
                options.optJSONObject("headers")?.let { headers ->
                    headers.keys().forEach { key ->
                        val value = headers.optString(key)
                        if (value.isNotEmpty()) builder.header(key, value)
                    }
                }

                val timeout = options.optLong("timeoutMs", 60_000L)
                val call = client.newBuilder()
                    .callTimeout(timeout, TimeUnit.MILLISECONDS)
                    .build()
                    .newCall(builder.build())

                inflight[id] = call
                call.execute().use { response ->
                    respond(
                        id,
                        JSONObject()
                            .put("status", response.code)
                            .put("statusText", response.message)
                            .put("text", response.body?.string().orEmpty()),
                    )
                }
            } catch (err: Exception) {
                // 取消要和前端的 /abort/i 判断对上，否则会被当成网络错误
                if (cancelled.remove(id)) {
                    fail(id, "Aborted: 请求已取消或超时")
                } else {
                    fail(id, "网络请求失败：${err.message ?: err::class.java.simpleName}")
                }
            } finally {
                inflight.remove(id)
            }
        }
    }

    @JavascriptInterface
    fun abort(id: String) {
        cancelled.add(id)
        inflight.remove(id)?.cancel()
    }

    private fun respond(id: String, payload: JSONObject) {
        val script = "window.__senseBridgeResolve(${JSONObject.quote(id)}, ${JSONObject.quote(payload.toString())})"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun fail(id: String, message: String) {
        val script = "window.__senseBridgeReject(${JSONObject.quote(id)}, ${JSONObject.quote(message)})"
        webView.post { webView.evaluateJavascript(script, null) }
    }
}
