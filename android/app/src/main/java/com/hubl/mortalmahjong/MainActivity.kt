package com.hubl.mortalmahjong

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.hubl.mortalmahjong.engine.MortalRuntime
import com.hubl.mortalmahjong.web.MortalJavascriptBridge
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private var webView: WebView? = null
    private var runtime: MortalRuntime? = null
    private var bridge: MortalJavascriptBridge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()
        showLoading("正在加载 Mortal 模型…")
        executor.execute {
            try {
                val loadedRuntime = MortalRuntime(applicationContext)
                runOnUiThread {
                    if (isFinishing || isDestroyed) {
                        loadedRuntime.close()
                    } else {
                        runtime = loadedRuntime
                        showTable(loadedRuntime)
                    }
                }
            } catch (error: Throwable) {
                runOnUiThread { showLoading("启动失败\n${error.message}") }
            }
        }
    }

    private fun showLoading(message: String) {
        val layout = FrameLayout(this).apply { setBackgroundColor(Color.rgb(18, 63, 52)) }
        val progress = ProgressBar(this).apply { isIndeterminate = true }
        layout.addView(
            progress,
            FrameLayout.LayoutParams(80, 80, Gravity.CENTER).apply { bottomMargin = 80 },
        )
        val text = TextView(this).apply {
            this.text = message
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        layout.addView(
            text,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ).apply { topMargin = 100 },
        )
        setContentView(layout)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun showTable(loadedRuntime: MortalRuntime) {
        val jsBridge = MortalJavascriptBridge(applicationContext, loadedRuntime)
        bridge = jsBridge
        webView = WebView(this).also { view ->
            view.setBackgroundColor(Color.rgb(18, 63, 52))
            view.settings.javaScriptEnabled = true
            view.settings.domStorageEnabled = true
            // The game board uses a fixed coordinate system. Keep Android's
            // accessibility font scale from enlarging labels without also
            // enlarging their layout boxes, which makes the score panel spill
            // into the rivers and the local hand on devices with large text.
            view.settings.textZoom = 100
            view.settings.allowFileAccess = true
            view.settings.allowContentAccess = false
            view.settings.mediaPlaybackRequiresUserGesture = false
            view.settings.setSupportZoom(false)
            view.settings.builtInZoomControls = false
            view.settings.displayZoomControls = false
            view.isVerticalScrollBarEnabled = false
            view.isHorizontalScrollBarEnabled = false
            view.overScrollMode = View.OVER_SCROLL_NEVER
            var blockingMultiTouch = false
            view.setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> blockingMultiTouch = false
                    MotionEvent.ACTION_POINTER_DOWN -> blockingMultiTouch = true
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        val wasBlocking = blockingMultiTouch
                        blockingMultiTouch = false
                        return@setOnTouchListener wasBlocking
                    }
                }
                blockingMultiTouch
            }
            view.addJavascriptInterface(jsBridge, "AndroidMortal")
            view.webViewClient = WebViewClient()
            view.webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    android.util.Log.d(
                        "MortalWeb",
                        "${consoleMessage.message()} @${consoleMessage.lineNumber()}",
                    )
                    return true
                }
            }
            view.loadUrl("file:///android_asset/table/index.html")
        }
        setContentView(webView)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else super.onBackPressed()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Launcher taps should only bring this existing table to the front.
        // singleTask routes them here instead of constructing another WebView
        // and starting a fresh game.
        hideSystemUi()
    }

    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    override fun onDestroy() {
        webView?.apply {
            removeJavascriptInterface("AndroidMortal")
            stopLoading()
            destroy()
        }
        bridge?.close()
        runtime?.close()
        executor.shutdownNow()
        super.onDestroy()
    }
}
