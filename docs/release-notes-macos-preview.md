# macOS 桌面版预览发布说明（草稿）

此文档用于首次 macOS 预览版发布时填写准确版本号和下载链接。真实 Apple Silicon 与 Intel 设备完成安装、通知和课程同步验证前，发布类型应标为 **预览版**。

## 下载

| 平台 | 资产 |
| --- | --- |
| Windows 安装版 | `ubc-assignment-manager-<版本>-setup.exe` |
| Windows 便携版 | `ubc-assignment-manager-<版本>-windows.zip` 及校验文件 |
| Apple Silicon | `ubc-assignment-manager-<版本>-macos-arm64.pkg` 及 `.pkg.sha256` |
| Intel Mac | `ubc-assignment-manager-<版本>-macos-x64.pkg` 及 `.pkg.sha256` |

macOS 预览版需要 macOS 12 或更新版本；同步 PrairieLearn 和 UBC WeBWorK 课程需要本机 Microsoft Edge。安装包会将独立 `.app` 安装到“应用程序”，作业主界面在 App 自有窗口打开；课程登录和同步时才会打开专用 Edge。

macOS 包尚未签名或公证。首次安装或打开若被系统阻止，请先确认文件来自本仓库并核对 SHA-256，然后按 [Apple 官方说明](https://support.apple.com/en-us/102445) 在“系统设置 → 隐私与安全性”中选择“仍要打开”。受管理设备可能禁止此操作。

Mac App 可从 Dock 或菜单栏重新打开；关闭主窗口后仍可在应用运行期间同步和发送 macOS 系统通知。首次使用须在“设置 → 提醒与同步”允许通知。电脑关机、睡眠或 App 完全退出时不能实时提醒。Mac 更新需手动下载并安装新版 `.pkg`；Windows 版继续支持应用内自动安装更新。

安装与使用细节见 [macOS 预览说明](macos-preview.md)。发布前须将 `<版本>` 替换为实际版号，并核对这四类产物及校验文件都已上传；不得将本草稿直接当作已完成的真实设备验收记录。
