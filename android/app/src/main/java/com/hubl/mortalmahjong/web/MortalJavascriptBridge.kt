package com.hubl.mortalmahjong.web

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.hubl.mortalmahjong.engine.MortalRuntime
import com.hubl.mortalmahjong.engine.NativeMortal
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MortalJavascriptBridge(
    private val context: Context,
    private val runtime: MortalRuntime,
) : AutoCloseable {
    private val bots = mutableMapOf<Int, Pair<Int, NativeMortal>>()

    @JavascriptInterface
    @Synchronized
    fun react(slot: Int, eventJson: String, canAct: Boolean): String {
        val event = JSONObject(eventJson)
        val entry = if (event.optString("type") == "start_game") {
            val playerId = event.getInt("id")
            bots.remove(slot)?.second?.close()
            (playerId to NativeMortal(playerId, runtime)).also { bots[slot] = it }
        } else {
            bots[slot] ?: error("Mortal-$slot received an event before start_game")
        }
        return entry.second.react(eventJson, canAct)
    }

    @JavascriptInterface
    fun savePaipu(payloadJson: String) {
        try {
            val payload = JSONObject(payloadJson)
            val majiang = payload.getJSONObject("majiang")
            val tenhou = payload.getJSONObject("tenhou")
            val targetId = majiang.optJSONObject("_mortal")?.optInt("target_player_id", -1) ?: -1
            val stamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date())
            val id = if (targetId >= 0) "_ID$targetId" else ""
            val base = "${stamp}_android$id"
            writeDocument("${base}_Majiang.json", majiang.toString(2))
            writeDocument("${base}_Tenhou.json", tenhou.toString(2))
            toast("两份牌谱已保存到“文档/Mortal麻将牌谱”")
        } catch (error: Throwable) {
            Log.e(TAG, "Unable to save paipu", error)
            toast("牌谱保存失败：${error.message}")
        }
    }

    @JavascriptInterface
    fun reportError(message: String) {
        Log.e(TAG, message)
        toast("Mortal 运行失败，请查看日志")
    }

    private fun writeDocument(displayName: String, text: String) {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
            put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                "${Environment.DIRECTORY_DOCUMENTS}/Mortal麻将牌谱",
            )
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = context.contentResolver.insert(collection, values)
            ?: error("Android did not create the output document")
        try {
            context.contentResolver.openOutputStream(uri, "w")!!.bufferedWriter().use {
                it.write(text)
                it.newLine()
            }
            context.contentResolver.update(
                uri,
                ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                null,
                null,
            )
        } catch (error: Throwable) {
            context.contentResolver.delete(uri, null, null)
            throw error
        }
    }

    private fun toast(message: String) {
        android.os.Handler(context.mainLooper).post {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }

    @Synchronized
    override fun close() {
        bots.values.forEach { it.second.close() }
        bots.clear()
    }

    companion object {
        private const val TAG = "MortalAndroid"
    }
}

