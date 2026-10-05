# 安全政策

## 支持范围

| 版本 | 安全更新 |
| --- | --- |
| 最新 GitHub Release | 支持 |
| 更早版本 | 请先升级到最新版本 |

## 报告安全问题

请使用仓库的 **Security → Report a vulnerability** 私密报告入口。不要在公开 Issue、Discussion、Pull Request 或截图中提交以下内容：

- PrairieLearn API Token；
- Server酱 SendKey；
- UBC 登录 Cookie、会话或个人身份信息；
- 可以访问他人课程或设备的链接、密钥和日志。

报告中请说明受影响版本、复现步骤、预期行为和实际影响。修复发布前，请不要公开漏洞细节。

## 本地数据

应用的课程缓存、个人备注、提醒配置和登录资料不应提交到 Git。发布包也不得包含 `.local-data`、状态文件、Cookie 或密钥配置文件。
