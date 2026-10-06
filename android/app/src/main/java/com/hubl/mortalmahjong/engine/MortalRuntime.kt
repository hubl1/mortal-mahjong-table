package com.hubl.mortalmahjong.engine

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.nio.FloatBuffer
import kotlin.math.max

class MortalRuntime(context: Context) : AutoCloseable {
    private val environment = OrtEnvironment.getEnvironment()
    private val sessionOptions = OrtSession.SessionOptions().apply {
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        setIntraOpNumThreads(max(1, Runtime.getRuntime().availableProcessors() - 1))
    }
    private val session: OrtSession

    init {
        val modelFile = installModel(context.applicationContext)
        session = environment.createSession(modelFile.absolutePath, sessionOptions)
        // Force model initialization before the WebView starts a game.
        infer(FloatArray(OBSERVATION_SIZE), 1L shl 45)
    }

    @Synchronized
    fun infer(observation: FloatArray, maskBits: Long): FloatArray {
        require(observation.size == OBSERVATION_SIZE) {
            "Unexpected Mortal observation size ${observation.size}"
        }
        val legalMask = Array(1) { row ->
            BooleanArray(ACTION_COUNT) { action -> row == 0 && ((maskBits ushr action) and 1L) == 1L }
        }
        OnnxTensor.createTensor(
            environment,
            FloatBuffer.wrap(observation),
            longArrayOf(1, OBSERVATION_CHANNELS.toLong(), TILE_COUNT.toLong()),
        ).use { observationTensor ->
            OnnxTensor.createTensor(environment, legalMask).use { maskTensor ->
                session.run(
                    mapOf(
                        "observation" to observationTensor,
                        "legal_mask" to maskTensor,
                    )
                ).use { result ->
                    @Suppress("UNCHECKED_CAST")
                    return ((result[0].value as Array<FloatArray>)[0]).clone()
                }
            }
        }
    }

    override fun close() {
        session.close()
        sessionOptions.close()
    }

    private fun installModel(context: Context): File {
        val modelDir = File(context.noBackupFilesDir, "model").apply { mkdirs() }
        val target = File(modelDir, MODEL_NAME)
        val modelSizeBytes = context.assets.openFd("model/$MODEL_NAME").use { it.length }
        if (target.isFile && target.length() == modelSizeBytes) return target

        val temporary = File(modelDir, "$MODEL_NAME.tmp")
        context.assets.open("model/$MODEL_NAME").use { input ->
            FileOutputStream(temporary).use { output -> input.copyTo(output, 1024 * 1024) }
        }
        check(temporary.length() == modelSizeBytes) {
            "Mortal model copy is incomplete (${temporary.length()} bytes)"
        }
        check(temporary.renameTo(target)) { "Unable to install Mortal model" }
        return target
    }

    companion object {
        private const val MODEL_NAME = "mortal-v4-fp32.onnx"
        private const val OBSERVATION_CHANNELS = 1012
        private const val TILE_COUNT = 34
        private const val ACTION_COUNT = 46
        private const val OBSERVATION_SIZE = OBSERVATION_CHANNELS * TILE_COUNT
    }
}
