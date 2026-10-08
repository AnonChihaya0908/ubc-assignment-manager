# UBC作业管理工具 1.3.2 macOS 预览版

修复 1.3.1 在 macOS Sonoma 14.6 上被系统判定为不兼容的问题。1.3.1 的 App 清单声称最低支持 macOS 12，但主程序和钥匙串辅助程序实际编译为最低 macOS 15。1.3.2 将两者的编译目标与 App 清单统一为 macOS 12，并在打包时核验可执行文件的最低版本。

| Mac 芯片 | 推荐下载 | 备用下载 |
| --- | --- | --- |
| Apple Silicon | `ubc-assignment-manager-1.3.2-macos-arm64.dmg` | `ubc-assignment-manager-1.3.2-macos-arm64.zip` |
| Intel | `ubc-assignment-manager-1.3.2-macos-x64.dmg` | `ubc-assignment-manager-1.3.2-macos-x64.zip` |

每个安装包均附同名 `.sha256` 文件。PKG 格式也保留。CI 会在 macOS 15 上构建两个架构，并将 Apple Silicon 安装包拿到 macOS 14 Sonoma 上安装和启动测试。

macOS 版仍是未签名、未公证的预览版，尚需真实 Mac 验证首次安装、通知与课程同步。按[安装与使用说明](macos-preview.md)操作。Windows 安装包继续从已有 Release 下载。
