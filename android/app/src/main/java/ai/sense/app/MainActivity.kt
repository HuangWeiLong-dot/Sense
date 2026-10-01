package ai.sense.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebResourceErrorCompat

/**
 * 把 Web 产物挂在一个正常的 https 源下，而不是 file://。
 * file:// 的源是 opaque 的，localStorage 之类的行为会和浏览器不一致。
 */
private const val APP_ORIGIN = "https://appassets.androidplatform.net"
private const val APP_HOST = "appassets.androidplatform.net"
private const val START_URL = "$APP_ORIGIN/assets/www/index.html"
private const val TAG = "SenseWebView"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    SenseWebView()
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SenseWebView() {
    val context = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }

    // 返回键先走 WebView 历史，避免一眼就走完整个应用
    BackHandler(enabled = webView?.canGoBack() == true) {
        webView?.goBack()
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                .build()
            val bridgeShim = ctx.assets.open("bridge.js").bufferedReader().use { it.readText() }

            // 调试构建开启 WebView 远程调试：配合 adb forward 可以直接看真实 DOM
            val debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
            if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false

                addJavascriptInterface(SenseBridge(this), "SenseNative")

                webViewClient = object : WebViewClientCompat() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest,
                    ): WebResourceResponse? {
                        val response = assetLoader.shouldInterceptRequest(request.url)
                        if (response == null) Log.w(TAG, "资源未命中: ${request.url}")
                        return response
                    }

                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceErrorCompat,
                    ) {
                        Log.e(TAG, "加载失败 ${request.url}: ${error.description}")
                    }

                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest,
                    ): Boolean {
                        val url = request.url
                        if (url.host == APP_HOST) return false
                        // 外链交给系统浏览器，别在应用里打开
                        runCatching {
                            ctx.startActivity(
                                Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        }
                        return true
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        Log.i(TAG, "页面加载完成: $url")
                        // 页面就绪后再注入桥接：前端此时还没发起任何请求
                        view.evaluateJavascript(bridgeShim, null)
                    }
                }

                loadUrl(START_URL)
                webView = this
            }
        },
    )
}
