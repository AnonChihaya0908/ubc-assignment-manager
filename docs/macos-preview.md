# macOS 桌面版：安装与使用

从 [v1.3.4 正式版](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases/tag/v1.3.4) 下载对应芯片的 DMG 或 ZIP。CI 已检查安装包完整性及 Sonoma 14 启动；真实 Mac 上的首次安装、通知和 Gradescope 登录仍需验证。此版本没有 Apple Developer ID 签名或公证。

## 选择安装包

在 Mac 的“苹果菜单 → 关于本机”查看芯片：

| 芯片 | DMG（推荐） | ZIP（备用） |
| --- | --- | --- |
| Apple M 系列 | `ubc-assignment-manager-<版本>-macos-arm64.dmg` | `ubc-assignment-manager-<版本>-macos-arm64.zip` |
| Intel | `ubc-assignment-manager-<版本>-macos-x64.dmg` | `ubc-assignment-manager-<版本>-macos-x64.zip` |

两种格式都要求 macOS 12 或更新版本。每个归档旁都有同名 `.sha256` 校验文件；需要核对时可在终端运行 `shasum -a 256 文件名.dmg` 或 `shasum -a 256 文件名.zip`。原有 PKG 仍会构建，供需要安装器的用户使用。只从项目仓库的工作流或 Release 获取文件。

## 安装和第一次打开

1. 使用 DMG 时，双击打开并将“UBC作业管理工具.app”拖到其中的“Applications”快捷方式；使用 ZIP 时，完整解压后将 `.app` 移到“应用程序”。两种归档都包含运行时，无需另装 Node.js。安装前请退出旧版 App；升级时替换旧 `.app`。
2. 在“应用程序”中双击“UBC作业管理工具”。主界面显示在 App 自有窗口；普通浏览器标签页不是日常使用入口。
3. 此构建尚未进行 Apple Developer ID 签名或公证。改用 DMG 或 ZIP 不会跳过 macOS 对 App 的安全检查。若首次打开被拦截，可在尝试打开后进入“系统设置 → 隐私与安全性”，找到对应提示并选择“仍要打开”，按系统要求确认。该选项通常只在尝试打开后短时间内出现。请先核对下载来源与 SHA-256；学校管理的设备可能不允许手动放行。参见 [Apple 的操作说明](https://support.apple.com/en-us/102445)。

## 课程、通知和退出

首次使用时自行添加 PrairieLearn、WeBWorK 或 Gradescope Canada 的具体课程网址；不会预置开发者课程。1.3.4 默认使用应用内置 WebKit 登录与同步，也可在设置中选择 Chrome 或 Edge。在“设置 → 课程与登录”打开登录窗口，完成登录后返回 App，点击左下角“立即同步”。作业主界面留在 App 窗口中。

在“设置 → 提醒与同步”允许 macOS 系统通知，可用测试按钮检查授权。提醒由正在运行的 App 发送，无需保持作业窗口打开，也不需要浏览器通知权限。关闭主窗口后，可从菜单栏图标或 Dock 重新打开；在应用菜单或“数据与退出”中选择退出才会停止后台服务。应用完全退出、电脑关机或睡眠期间不能实时发送本地通知；重新运行后，仍未截止且符合规则的作业会继续检查。每日微信汇总沿用同一天补发规则。

按课程关闭提醒、免打扰时段、提前提醒时间以及作业完成状态会同时影响 macOS 截止通知。通知授权被拒绝时，请在“系统设置 → 通知”中允许此应用。

## 更新与数据

应用可在“设置 → 常规与窗口”检查 GitHub 更新。下载相同架构的新版本后，退出旧版 App 并手动替换“应用程序”中的 `.app`。目前不提供应用内自动替换和重启。课程、作业及设置存放在当前账户的 `~/Library/Application Support/UBC作业管理工具/data`，替换 App 不会清除。不要公开这个目录、SendKey 或专用浏览器登录资料。

真实 Apple Silicon 与 Intel Mac 上的首次安装、Gatekeeper 提示、Dock/菜单栏、系统通知和课程同步仍需验证。发现问题请在 [Issues](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) 中注明 macOS 版本、芯片和复现步骤，不要上传个人课程数据或凭证。
