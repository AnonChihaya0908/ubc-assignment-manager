# UBC作业管理工具 1.3.3 macOS 预览版

修复 1.3.2 首次打开时可能被 macOS Sonoma 报告“App 已损坏”的问题。1.3.2 的主程序由 Swift 链接器临时签名，但应用资源加入后没有重新签署整个 App；严格校验报告资源封印缺失。1.3.3 在所有资源写入后签署整个 App，并对 ZIP 解压结果、DMG 挂载内容及 Sonoma 上的安装结果执行严格签名校验。

| Mac 芯片 | 推荐下载 | 备用下载 |
| --- | --- | --- |
| Apple Silicon | `ubc-assignment-manager-1.3.3-macos-arm64.dmg` | `ubc-assignment-manager-1.3.3-macos-arm64.zip` |
| Intel | `ubc-assignment-manager-1.3.3-macos-x64.dmg` | `ubc-assignment-manager-1.3.3-macos-x64.zip` |

每个安装包均附同名 `.sha256` 文件，PKG 格式也保留。下载后请核对文件校验值，并从 DMG 或 ZIP 中完整复制 App 到“应用程序”。

此版本使用临时的完整性签名，**没有 Developer ID 身份签名，也没有 Apple 公证**。首次打开仍可能需要在系统设置中手动允许；这与“签名损坏”是不同的系统提示。尚需真实 Mac 验证首次安装、通知与课程同步。Windows 安装包继续从已有 Release 下载。
