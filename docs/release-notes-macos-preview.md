# UBC 作业管理工具 1.3.0 预览版

本次提供 Windows 安装版、便携版，以及 Apple Silicon 和 Intel 两种 macOS `.pkg` 安装包。macOS 版是独立桌面 App；主界面在自有窗口打开，登录课程时使用本机 Microsoft Edge。

## 下载

| 平台 | 文件 |
| --- | --- |
| Windows 安装版 | `ubc-assignment-manager-1.3.0-setup.exe` |
| Windows 便携版 | `ubc-assignment-manager-1.3.0-windows.zip` 与 `.zip.sha256` |
| Apple Silicon | `ubc-assignment-manager-1.3.0-macos-arm64.pkg` 与 `.pkg.sha256` |
| Intel Mac | `ubc-assignment-manager-1.3.0-macos-x64.pkg` 与 `.pkg.sha256` |

## 验证与限制

Windows 逻辑测试、浏览器集成测试，以及两种 macOS 架构的构建、安装和启动测试已在 GitHub CI 通过。macOS 尚未在用户真实设备上完成首次安装、通知权限和课程同步验收，因此本次标记为**预览版**；Windows 1.2.1 仍是最新稳定版，应用内自动更新不会推送本预览版。

macOS 安装包未进行 Apple Developer ID 签名或公证。首次安装或打开若被系统阻止，请先核对下载来源与 SHA-256，再参考 [Apple 官方说明](https://support.apple.com/en-us/102445) 在“系统设置 → 隐私与安全性”中选择“仍要打开”。受管理设备可能禁止此操作。macOS 12 或更新版本及 Microsoft Edge 是必要条件。

Mac App 可从 Dock 或菜单栏重新打开。首次使用系统通知须在“设置 → 提醒与同步”允许通知；电脑关机、睡眠或 App 完全退出时不能实时提醒。Mac 更新需手动下载并安装对应架构的新版 `.pkg`，Windows 稳定版继续支持应用内自动安装更新。详细说明见 [macOS 安装与使用说明](macos-preview.md)。
