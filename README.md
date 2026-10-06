# Mortal 麻将

一个本地优先的四人日麻牌桌。界面基于开源项目“电脑麻将（Majiang）”，另外三家由 Mortal 控制，并提供当前局面的 Mortal 推荐、牌谱保存和离线复盘。

本仓库是可公开发布的源码仓库，不包含模型权重、用户牌谱、日志、构建产物、服务器地址或签名密钥。它同时保留了我们修改过的 Mortal 接入层与对应的 `libriichi` 源码，而不只是网页文件。

## 主要目录

- `vendor/Majiang-master/`：MIT 许可的牌桌界面及本项目的界面修改。
- `vendor/Akagi-MjaiBot-Mortal-main/`：AGPL-3.0 许可的 Mortal 接入层；`model.py` 和新增的 `bot_pool.py` 包含本项目修改。
- `android/native/upstream/`：Mortal / `libriichi` 的 AGPL-3.0 对应源码。
- `android/app/`：Android 离线版 Kotlin UI 与运行时源码。
- `electron-app/`：macOS、Windows 桌面外壳。
- `native-app/`：轻量 macOS Swift 外壳。
- `web-deploy/`：浏览器版网关、服务模板和测试。
- `killer-reviewer/`、`reviewer/`：离线牌谱复盘界面。
- `packaging/`：桌面发行包的构建脚本与第三方声明。

## 模型权重

模型权重不提交到 Git。将兼容的 Mortal 权重放入 `models/`，然后通过环境变量 `MORTAL_MODEL_PATH` 指向它。现有桌面构建脚本默认寻找：

```text
models/mortal-finetune-ours560-step-1100000.pth
```

权重来源、授权和分发条件与本源码仓库分开处理，详见 `models/README.md`。

## 从源码运行

完整依赖、构建及部署步骤见 [`docs/BUILDING.md`](docs/BUILDING.md)。最简流程是：

1. 安装 Node.js 20+、Python 3.11/3.12、Rust 和 ImageMagick。
2. 安装 `runtime/`、牌桌和 Electron 的 Node 依赖。
3. 从 `android/native/upstream/` 编译 `libriichi`，并安装 PyTorch、NumPy 与 Requests。
4. 放置自己的兼容模型权重。
5. 构建 `vendor/Majiang-master/` 后启动本地桌面壳或网页服务。

这些步骤不会下载或自动选择模型权重。

## 许可证

本项目的组合与修改部分按 GNU Affero General Public License v3.0 发布，见 [`LICENSE`](LICENSE)。通过网络提供修改后的程序时，也应向使用者提供当前运行版本的对应源码。

仓库中的 MIT 与 CC0 组件继续保留其原许可证。详细清单和上游链接见 [`docs/LICENSING.md`](docs/LICENSING.md) 与 [`packaging/legal/THIRD_PARTY_NOTICES.txt`](packaging/legal/THIRD_PARTY_NOTICES.txt)。

这不是上游项目的官方发行版，也不代表上游作者认可本项目。
