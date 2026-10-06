# Android 离线版

`app/` 是手机端 Kotlin 源码；`native/android-bridge/` 是连接 Kotlin 与 `libriichi` 的 Rust/JNI 层；`native/upstream/` 是对应的 Mortal / `libriichi` AGPL 源码。

模型、生成后的网页资源、JNI 动态库和 APK 不提交到 Git。构建流程：

1. 在仓库根目录构建网页：`(cd vendor/Majiang-master && npm ci && npm run release)`。
2. 用 `android/export_mortal_onnx.py` 把兼容的 Mortal v4 权重导出为 ONNX，或准备已有的兼容 ONNX。
3. 运行 `android/prepare-app-assets.sh /absolute/path/to/model.onnx`。
4. 安装 Android NDK 与 `cargo-ndk`，在 `android/native/android-bridge` 中执行 `cargo ndk -t arm64-v8a -o ../../app/src/main/jniLibs build --release`。
5. 在 `android/` 运行 `./gradlew :app:assembleDebug`。

生成的 APK 位于 `android/app/build/outputs/apk/`。
