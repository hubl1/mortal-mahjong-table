# 构建与运行

本文描述从干净检出构建本项目所需的源代码、依赖与用户提供的数据。命令均在仓库根目录执行。

## 1. 系统依赖

- Node.js 20 或更新版本
- Python 3.11 或 3.12
- Rust stable toolchain
- macOS 桌面壳：Xcode Command Line Tools / Swift 5.9+
- 重新生成牌面：ImageMagick 7（`magick`）

## 2. JavaScript 依赖和牌桌资源

```sh
(cd runtime && npm ci)
(cd vendor/Majiang-master && npm ci && npm run release)
(cd electron-app && npm ci)
```

`npm run release` 生成 `dist/*.html`、`dist/css/` 与 `dist/js/`。仓库保留了运行所需的原始图片和声音，但不提交这些可重复生成的程序包。

如需离线复盘页面，将 `killer-reviewer/` 的内容复制到 `vendor/Majiang-master/dist/mortal-reviewer/`。桌面打包脚本也会使用该目录。

## 3. Python 推理环境和 libriichi

创建虚拟环境并安装推理依赖：

```sh
python3 -m venv .venv311
.venv311/bin/python -m pip install 'torch<2.9' 'numpy>=1.24' 'requests>=2.28' 'pyinstaller>=6.11,<7'
```

从随仓库提供的 AGPL 源码编译 `libriichi`：

```sh
cd android/native/upstream
cargo build -p libriichi --lib --release
```

在 macOS/Linux 上，把生成的动态库复制为：

```text
vendor/Akagi-MjaiBot-Mortal-main/libriichi.so
```

Windows 上复制并命名为：

```text
vendor/Akagi-MjaiBot-Mortal-main/libriichi.pyd
```

更详细的平台说明在 `android/native/upstream/docs/src/user/build.md`。

## 4. 模型

把兼容权重放到 `models/`，并设置：

```sh
export MORTAL_MODEL_PATH=/absolute/path/to/model.pth
```

`web-deploy/start-web.sh` 和桌面打包配置目前使用项目开发时的默认文件名。如使用其他文件名，请同时修改这些配置，或在启动自己的服务时显式传入环境变量。权重不属于本 Git 仓库。

## 5. 运行与打包

开发模式下运行 Electron：

```sh
(cd electron-app && npm start)
```

构建 Swift 外壳：

```sh
native-app/build-app.sh
```

构建 macOS 与 Windows 桌面发行包：

```sh
packaging/scripts/build-desktop.sh
```

生成的应用、压缩包、嵌入式 Python、模型和签名文件均被 `.gitignore` 排除。

## 6. 浏览器服务

`web-deploy/start-web.sh` 需要：

- `.runtime/node/bin/node` 或按部署环境调整脚本；
- `.venv/bin/python` 或按部署环境调整脚本；
- 可用的模型权重；
- 已构建的 `vendor/Majiang-master/dist/`。

`web-deploy/mortal-web.service` 是 systemd 用户服务模板。反向代理/隧道配置请从 `web-deploy/frpc-web.example.ini` 复制为 `frpc-web.ini`，填入自己的服务器信息。真实配置被 Git 忽略。

## 7. 修改说明

与上游 Akagi 接入层相比，本项目至少包含以下实质修改：

- `vendor/Akagi-MjaiBot-Mortal-main/model.py`：支持通过 `MORTAL_MODEL_PATH` 选择模型。
- `vendor/Akagi-MjaiBot-Mortal-main/bot_pool.py`：共享模型加载、并发桌面机器人和推荐 HTTP 服务。
- `vendor/Majiang-master/src/`：本地桌面/移动布局、牌谱导出、用户名、Mortal 推荐及铳率展示等界面和协议改动。

公开部署新的修改版本时，请同步公开对应提交，不要只链接未包含这些修改的上游仓库。

## 8. Android

Android 工程是 `android/` 下的独立 Gradle 项目。Kotlin UI、Rust/JNI 桥和 Mortal 对应源码都已纳入仓库；ONNX 权重、网页构建输出、JNI 动态库和 APK 由构建时生成。完整步骤见 `android/README.md`。
