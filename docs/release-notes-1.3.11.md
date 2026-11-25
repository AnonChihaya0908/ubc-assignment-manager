## PrairieLearn 截止时间

- 修复 `end of tomorrow`、`end of today` 等截止时间同步后显示「暂无日期」的问题。
- 支持 `tomorrow, 6pm` 等带具体时刻的写法。日终按当地日期记录为 23:59:59，网页在绝对日期和「今天」「明天」之间切换时，截止时间保持一致。
- 更新后点「立即同步」，重新读取 PrairieLearn 页面上的截止时间。

## 下载

| 系统 | 推荐安装包 | 其他格式 |
| --- | --- | --- |
| Windows 10/11 | `ubc-assignment-manager-1.3.11-setup.exe` | Windows ZIP |
| macOS Apple Silicon | `ubc-assignment-manager-1.3.11-macos-arm64.dmg` | arm64 ZIP、PKG |
| macOS Intel | `ubc-assignment-manager-1.3.11-macos-x64.dmg` | x64 ZIP、PKG |

每个安装包附有同名 `.sha256` 文件。Windows 支持应用内更新。macOS 上请先退出旧版，再替换应用。

## 验证范围

CI 覆盖 Windows 逻辑测试、浏览器测试和安装包构建，以及 macOS 15 的双架构打包、安装启动和完整性校验。Sonoma 14 仍待实机复核。macOS 安装包采用临时签名，首次打开请参阅 [macOS 安装说明](https://github.com/AnonChihaya0908/ubc-assignment-manager/blob/v1.3.11/docs/macos-preview.md)。
