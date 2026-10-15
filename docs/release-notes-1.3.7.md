# UBC 作业管理工具 1.3.7

此维护版本修复 PrairieTest 考试列表中的多余预约操作记录，以及部分设备上的时区显示问题。

## 修复

- 已预约考试同步后，不再把“Make a reservation”操作链接识别为另一场考试。
- 最近一次成功同步中未再出现的 PrairieTest 记录退出默认考试列表和计数；原数据保留，可通过“显示已归档及未确认考试”查看。同步失败不会清空已有数据。
- 设备未提供时区名称时，考试时间改为显示准确的 UTC 偏移量，不再显示 `undefined`。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.7-setup.exe` | 同版本 Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.7-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.7-macos-x64.dmg` | 同架构 ZIP、PKG |

每个安装文件旁提供同名 SHA-256 校验文件。Windows 可在应用内自动下载安装并重启；Mac 用户需退出旧版 App 后手动替换。课程、考试和设置保存在用户数据目录，不随安装包覆盖。

## 验证范围

单元测试、浏览器界面测试和 Windows/macOS CI 均须通过后发布。开发时已在用户授权打开的 PrairieTest Home 页面只读核对当前预约列表；新版安装后的实际同步及提醒仍需用户在自己的设备上确认。macOS 包未做 Apple Developer ID 签名或公证，首次打开可能需要按[安装说明](macos-preview.md)手动允许。
