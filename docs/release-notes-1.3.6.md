# UBC 作业管理工具 1.3.6

此维护版本修复 PrairieTest 已预约考试的同步失败，Windows 与 macOS 安装包均从同一份代码构建。

## 修复

- 识别 PrairieTest 预约页面中带毫秒及 UTC 偏移的时间值，例如 `2026-10-19T14:00:00.000-07:00`。
- 从同一考试行读取预约日期与时区，避免将同页其他考试或考场链接当作当前考试。
- 同步无法确认考试时间时仍保留原有考试数据。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.6-setup.exe` | 同版本 Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.6-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.6-macos-x64.dmg` | 同架构 ZIP、PKG |

每个安装文件旁提供同名 SHA-256 校验文件。Windows 可以在应用内自动下载安装并重启；Mac 用户需退出旧版 App 后手动替换。课程、考试和设置保存在用户数据目录，不随安装包覆盖。

## 验证范围

核心测试、浏览器集成测试及 Windows/macOS CI 均需通过后发布。开发时已在用户授权打开的真实 PrairieTest Home 页面上只读验证预约状态、时间及时区，尚需用户在新版安装包中确认实际同步与提醒。macOS 包未做 Apple Developer ID 签名或公证，首次打开可能需要按[安装说明](macos-preview.md)手动允许。
