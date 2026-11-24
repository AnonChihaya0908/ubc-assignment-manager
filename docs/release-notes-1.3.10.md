# UBC 作业管理工具 1.3.10

本版修复课程网站改版后的截止时间同步，整合考试提醒界面与同步流程的改进。

## 改进与修复

- PrairieLearn 新版 `100% until Thu, Nov 26, end of day`、`100% until Fri, Nov 27, 6:05pm` 等截止时间可正常读取；旧格式仍兼容。
- WeBWorK 的 MST/MDT 截止时间可按来源时区换算；网页不再显示已截止作业的 Due 行时，保留此前同步的截止时间。
- Gradescope 课程表同时出现可点击作业和无链接行时，继续同步可点击作业。
- 考试提醒将即将到来与已结束的考试分组显示。侧栏加号用于手动添加，PrairieTest 登录移至设置，侧栏底部的“立即同步”按当前页面执行对应的只读同步。
- 同步浏览器按需启动并在同步结束后关闭。每日微信汇总先尝试刷新课程与 PrairieTest 数据，再生成消息；某个来源失败时会标明数据状态。

## 下载

| 系统 | 推荐文件 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.10-setup.exe` | 同版本 Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.10-macos-arm64.dmg` | 同架构 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.10-macos-x64.dmg` | 同架构 ZIP、PKG |

每个安装文件附有同名 `.sha256` 校验文件。Windows 可在应用内安装更新；macOS 需退出旧版 App 后手动替换，用户数据保存在独立目录。

## 验证范围

Windows 和 macOS 逻辑测试、浏览器集成测试、双架构 macOS 打包、macOS 15 Apple Silicon 安装与签名检查由 CI 验证。课程网站格式使用与用户截图一致的页面夹具测试，尚未通过真实账号同步复核。GitHub 已停用 macOS 14 运行环境，Sonoma 14 需在真实设备上复核。macOS 包未做 Apple Developer ID 签名或公证，首次打开可能需要按[安装说明](macos-preview.md)手动允许。
