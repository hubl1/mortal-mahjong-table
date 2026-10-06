# 许可证与来源

## 本项目组合与修改

本仓库中的组合、接入代码和修改按 GNU Affero General Public License v3.0（AGPL-3.0）提供。根目录 `LICENSE` 是许可证全文。

如果把修改后的程序作为网站提供给别人使用，AGPL 的网络交互条款通常要求向这些用户提供该运行版本的完整对应源码。推荐让网页中的“源码”链接直接指向你公开的本仓库提交或发行标签，而不是只指向上游项目。

## 第三方组件

| 组件 | 位置 | 上游 | 许可证 |
| --- | --- | --- | --- |
| Majiang / 电脑麻将 | `vendor/Majiang-master` | <https://github.com/kobalab/Majiang> | MIT |
| Akagi MjaiBot Mortal integration | `vendor/Akagi-MjaiBot-Mortal-main` | <https://github.com/shinkuan/Akagi-MjaiBot-Mortal> | AGPL-3.0 |
| Mortal / libriichi | `android/native/upstream` | <https://github.com/Equim-chan/Mortal> | AGPL-3.0-or-later |
| Killer Mortal Reviewer | `killer-reviewer` | <https://github.com/AndyOlsen/Killer-Mortal-Reviewer> | MIT |
| OpenTiles 牌面 | `vendor/Majiang-master/dist/img/skin-classic2d` | OpenTiles / MahjongTrainer 所带素材 | CC0 1.0 / public domain dedication |

每个上游源码目录中的原许可证文件均应保留。Node、Electron、Python、PyTorch、NumPy、ONNX Runtime 及其传递依赖分别适用各自许可证；构建时生成的依赖清单不能代替这些许可证文本。

## 不在仓库中的文件

模型权重、用户牌谱、日志、服务器地址、认证配置、签名证书和预编译发行包都不属于本源码提交。公开分发这些文件前需要分别确认其来源和授权。

本说明用于整理发布边界，并非法律意见。
