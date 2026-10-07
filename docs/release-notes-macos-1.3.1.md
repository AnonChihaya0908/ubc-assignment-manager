# UBC作业管理工具 1.3.1 macOS 预览版

本次 macOS 预览版同时提供 DMG 和 ZIP，分别构建 Apple Silicon（arm64）与 Intel（x64）版本。DMG 为推荐下载方式：打开后将 App 拖入“应用程序”；ZIP 为备用方式：完整解压后将 App 移入“应用程序”。原有 PKG 格式也保留。

| Mac 芯片 | 推荐下载 | 备用下载 |
| --- | --- | --- |
| Apple Silicon | `ubc-assignment-manager-1.3.1-macos-arm64.dmg` | `ubc-assignment-manager-1.3.1-macos-arm64.zip` |
| Intel | `ubc-assignment-manager-1.3.1-macos-x64.dmg` | `ubc-assignment-manager-1.3.1-macos-x64.zip` |

每个下载文件均附有同名 `.sha256` 校验文件。两个归档包含同一次构建的独立 `.app` 和运行时；安装时不需要 Node.js，也没有额外的系统服务。

与旧的 1.3.0 预览版相比，本版还包含应用内置 WebKit 登录与同步、Chrome 选择、中英文界面和本机 Gmail 每日邮件提醒。Windows 1.3.0 预览版和 1.2.1 稳定版继续在各自的 Release 页面提供。

**预览限制：**这些 macOS 文件未签名、未公证，仍需在真实 Mac 上验证首次安装、Gatekeeper 提示、通知和课程同步。改用 DMG 或 ZIP 不会绕过 macOS 对 App 的安全检查。若确认下载来源可信且系统阻止首次打开，请按[macOS 安装与使用说明](macos-preview.md)操作。
