# UBC 作业管理工具 1.3.8

本版本统一 British Columbia 的本地时间显示，调整每日微信汇总结构，并修复手动考试时间输入。

## 更新内容

- British Columbia 时区下的应用显示、手动输入和提醒时间使用一致的本地时间规则；旧版运行环境也有回退处理。
- 每日微信汇总先列出未来 7 天考试，再按 PrairieLearn、WeBWorK、Gradescope → 课程 → 作业缩进；最后统一显示同步时间，并单独说明失败或过期的课程。没有发送私有课程网址或 SendKey。
- 手动添加考试时，“待预约”也可填写已知的开始时间。开始时间和预约截止时间统一使用 `YYYY/MM/DD HH:mm`，会校验无效日期。
- 提高 Windows 界面测试和 macOS DMG 构建在 CI 中的稳定性。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.8-setup.exe` | 同版本 Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.8-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.8-macos-x64.dmg` | 同架构 ZIP、PKG |

每个安装文件均附带 SHA-256 校验文件。Windows 可在应用内安装更新并重启；macOS 需退出旧版 App 后手动替换。用户数据保存在独立目录，不会随安装包覆盖。

## 验证范围

本地逻辑测试 75 项、浏览器界面测试 5 项通过；Windows 与 macOS 构建、macOS Sonoma 14 启动和代码扫描均由 CI 验证。每日微信汇总已用本机应用状态只读生成预览，未发送真实消息。macOS 包未做 Apple Developer ID 签名或公证，首次打开可能需要按[安装说明](macos-preview.md)手动允许。
