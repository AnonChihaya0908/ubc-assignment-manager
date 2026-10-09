# UBC 作业管理工具 1.3.4

Windows 与 macOS 使用同一份 1.3.4 源码构建。这是继 1.3.3 macOS 专项预览版后的跨平台正式发布。

## 本次更新

- 加入 Gradescope Canada 课程与作业同步：未提交作业显示为待完成，已提交或已评分的作业显示为已完成；成绩无需达到 100%。
- 修复 Gradescope 未提交作业使用按钮时可能漏读，以及把发布时间误当截止时间的问题。普通截止与晚交截止分别保存。
- 支持 PrairieLearn、UBC WeBWorK 和 Gradescope 的统一列表、日历与提醒。
- Windows 与 macOS 安装包均附 SHA-256 校验文件。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.4-setup.exe` | `ubc-assignment-manager-1.3.4-windows.zip` |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.4-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.4-macos-x64.dmg` | 同架构 ZIP、PKG |

Windows 便携版需完整解压后运行。Mac 用户请按芯片选择安装包，安装步骤见[macOS 安装说明](https://github.com/AnonChihaya0908/ubc-assignment-manager/blob/v1.3.4/docs/macos-preview.md)。所有作业和登录数据留在各自电脑的用户数据目录，升级不会将其写入安装包。

## macOS 安装说明

macOS 应用具有临时完整性签名，但没有 Apple Developer ID 签名或公证。Gatekeeper 可能要求在“系统设置 → 隐私与安全性”手动允许首次打开；学校管理的设备可能禁止侧载。CI 已验证 macOS Sonoma 14 启动与包完整性；真实 Mac 上的首次安装、通知和 Gradescope WebKit 登录仍需验证。

Windows 上已使用真实 Gradescope 课程页面验证未提交与已评分作业及普通截止时间。若课程网站改变页面结构，同步会提示错误并保留上次有效数据。请通过 [Issues](https://github.com/AnonChihaya0908/ubc-assignment-manager/issues) 报告问题，不要附上登录凭据或私人课程截图。
