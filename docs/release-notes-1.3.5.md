# UBC 作业管理工具 1.3.5

Windows 与 macOS 从同一份源码构建。此版本包含 1.3.4 发布后的仪表盘、学年学期管理和考试提醒功能。

## 更新

- 新增按学年与学期查看的作业仪表盘。
- 新增独立考试提醒页：可手动录入考试，或从本人登录后的 PrairieTest Home 只读同步预约；考试不会混入作业完成率。
- 修复 PrairieTest Home 蓝色卡片和已预约考试行的读取，支持页面直接显示的日期、时区及分钟时长；测试中心链接不会被当作考试。
- 当运行中的旧后台没有 PrairieTest 接口时，给出退出并重启或安装新版的明确提示。页面无法确认考试列表为空时保留上次数据。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | ubc-assignment-manager-1.3.5-setup.exe | ubc-assignment-manager-1.3.5-windows.zip |
| macOS Apple Silicon | ubc-assignment-manager-1.3.5-macos-arm64.dmg | 同架构 ZIP、PKG |
| macOS Intel | ubc-assignment-manager-1.3.5-macos-x64.dmg | 同架构 ZIP、PKG |

每个文件旁提供 SHA-256 校验文件。Windows 可从旧版自动下载安装并重启；Mac 用户需退出旧版 App 后手动替换。课程、考试与设置保存在当前用户数据目录，不包含在安装包中。

## 已知验证范围

Windows 单元与浏览器测试、macOS core、ARM/x64 打包及 Sonoma 14 启动 CI 已通过。PrairieTest 真实账号登录、预约变更和实际提醒仍需用户设备验收；相关 issue #91 保持开放。macOS 包未做 Apple Developer ID 签名或公证，首次启动可能需要按安装说明手动允许。
