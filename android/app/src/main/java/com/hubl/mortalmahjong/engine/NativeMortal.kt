package com.hubl.mortalmahjong.engine

class NativeMortal(
    private val playerId: Int,
    private val runtime: MortalRuntime,
) : AutoCloseable {
    private var handle = nativeCreate(playerId.toLong())

    @Synchronized
    fun react(eventJson: String, canAct: Boolean): String {
        check(handle != 0L) { "Mortal bot is closed" }
        if (!nativeUpdate(handle, eventJson, canAct)) return "{\"type\":\"none\"}"

        val observation = nativeObservation(handle, false)
        val mask = nativeMask(handle, false)
        val qValues = runtime.infer(observation, mask)
        val kanQValues = if (nativeNeedsKanSelection(handle)) {
            runtime.infer(nativeObservation(handle, true), nativeMask(handle, true))
        } else {
            FloatArray(0)
        }
        return nativeReaction(handle, qValues, kanQValues)
    }

    @Synchronized
    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }

    companion object {
        init {
            System.loadLibrary("mortal_android")
        }

        @JvmStatic private external fun nativeCreate(playerId: Long): Long
        @JvmStatic private external fun nativeDestroy(handle: Long)
        @JvmStatic private external fun nativeUpdate(handle: Long, eventJson: String, canAct: Boolean): Boolean
        @JvmStatic private external fun nativeObservation(handle: Long, kanSelect: Boolean): FloatArray
        @JvmStatic private external fun nativeMask(handle: Long, kanSelect: Boolean): Long
        @JvmStatic private external fun nativeNeedsKanSelection(handle: Long): Boolean
        @JvmStatic private external fun nativeReaction(
            handle: Long,
            qValues: FloatArray,
            kanQValues: FloatArray,
        ): String
    }
}

