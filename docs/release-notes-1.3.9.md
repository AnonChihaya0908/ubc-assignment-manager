# UBC 作业管理工具 1.3.9

此补丁修复 PrairieTest 考试结束后的历史记录显示。

## 修复

- 已过考试时间和已知时长的 PrairieTest 预约，即使不再出现在网站当前预约列表，也会留在应用的“已结束”分类和计数中。以 CPSC 317 Quiz 2 的情况为例，旧记录仍在本机，更新应用后即可重新显示，无需手动补录。
- 未在最新同步中出现的未来预约和待预约项目仍会从默认列表隐藏，避免把取消、改期或误识别的项目当成已结束考试；其缓存仍可通过“显示已归档及未确认考试”查看。
- 已结束的历史记录显示“已结束”及保留说明，不会作为待办重新提醒。中英文界面均有对应提示。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.9-setup.exe` | 同版本 Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.9-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.9-macos-x64.dmg` | 同架构 ZIP、PKG |

每个安装文件均附带 SHA-256 校验文件。Windows 可在应用内安装更新并重启；macOS 需退出旧版 App 后手动替换，用户数据保存在独立目录。

## 验证范围

逻辑测试 75 项、浏览器界面测试 5 项通过，包含过期预约保留与失效预约入口隐藏的回归检查。Windows、macOS arm64/x64 构建及 Sonoma 14 启动由 CI 验证。macOS 包未做 Apple Developer ID 签名或公证，首次打开可能需要按[安装说明](macos-preview.md)手动允许。
