# macOS 桌面版预览：安装与使用

目前 macOS 版仍在真实设备验证阶段。预览构建来自仓库的 [CI 工作流](https://github.com/AnonChihaya0908/ubc-assignment-manager/actions/workflows/ci.yml)；完成验证前不作为稳定版推荐。Windows 安装版与便携版继续在 [Releases](https://github.com/AnonChihaya0908/ubc-assignment-manager/releases) 提供。

## 选择安装包

在 Mac 的“苹果菜单 → 关于本机”查看芯片：

| 芯片 | 下载文件 |
| --- | --- |
| Apple M 系列 | `ubc-assignment-manager-<版本>-macos-arm64.pkg` |
| Intel | `ubc-assignment-manager-<版本>-macos-x64.pkg` |

两种包都要求 macOS 12 或更新版本。预览构建还提供同名 `.pkg.sha256` 文件；需要核对文件时可在终端运行 `shasum -a 256 文件名.pkg`，比较输出与校验文件的十六进制值。只从项目仓库的工作流或 Release 获取安装包。

## 安装和第一次打开

1. 双击对应架构的 `.pkg`，按安装器提示安装到“应用程序”。安装包附带运行时，无需另装 Node.js，也不执行安装后高权限脚本。
2. 在“应用程序”中双击“UBC作业管理工具”。主界面显示在 App 自有窗口；普通浏览器标签页不是日常使用入口。
3. 这个预览包尚未进行 Apple Developer ID 签名或公证。若 macOS 阻止安装或首次打开，可在尝试打开后进入“系统设置 → 隐私与安全性”，找到对应提示并选择“仍要打开”，按系统要求确认。该选项通常只在尝试打开后短时间内出现。请先核对下载来源与 SHA-256；学校管理的设备可能不允许手动放行。参见 [Apple 的操作说明](https://support.apple.com/en-us/102445)。

## 课程、通知和退出

首次使用时自行添加 PrairieLearn 或 WeBWorK 课程；不会预置开发者课程。课程登录与同步需要本机安装 Microsoft Edge：在“设置 → 课程与登录”打开专用登录窗口，完成登录后返回 App，点击左下角“立即同步”。Edge 只用于课程网站，作业主界面留在 App 窗口中。

在“设置 → 提醒与同步”允许 macOS 系统通知，可用测试按钮检查授权。提醒由正在运行的 App 发送，无需保持作业窗口打开，也不需要浏览器通知权限。关闭主窗口后，可从菜单栏图标或 Dock 重新打开；在应用菜单或“数据与退出”中选择退出才会停止后台服务。应用完全退出、电脑关机或睡眠期间不能实时发送本地通知；重新运行后，仍未截止且符合规则的作业会继续检查。每日微信汇总沿用同一天补发规则。

按课程关闭提醒、免打扰时段、提前提醒时间以及作业完成状态会同时影响 macOS 截止通知。通知授权被拒绝时，请在“系统设置 → 通知”中允许此应用。

## 更新与数据

应用可在“设置 → 常规与窗口”检查 GitHub 更新。macOS 版发现新版本后，请下载相同架构的新版 `.pkg` 并手动安装；目前不提供应用内自动替换和重启。课程、作业及设置存放在当前账户的 `~/Library/Application Support/UBC作业管理工具/data`，覆盖安装不会清除。不要公开这个目录、SendKey 或 Edge 登录资料。

预览版仍需在真实 Apple Silicon 与 Intel Mac 上验证首次安装、Gatekeeper 提示、Dock/菜单栏、系统通知和 Edge 同步。发现问题请在 [Issues](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) 中注明 macOS 版本、芯片和复现步骤，不要上传个人课程数据或凭证。
