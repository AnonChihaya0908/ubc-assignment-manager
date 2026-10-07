# 邮件提醒 / Email reminders

## 配置

1. 使用你自己的 Gmail 发件账户，在 Google 账户设置中开启两步验证并创建**应用专用密码**。不要在本应用中输入 Gmail 主密码。Google 的[应用专用密码说明](https://support.google.com/accounts/answer/185833)列出了适用条件和限制。
2. 打开“设置 → 提醒与同步 → 每日邮件提醒”，输入 Gmail 发件地址、应用专用密码和收件地址。点击“连接发件账户”，然后点击“发送测试邮件”。
3. 在收件箱确认测试邮件。选择每天的设备当地时间和提醒范围，勾选“启用每日邮件提醒”，再保存设置。收件地址改变后，需重新发送测试邮件。
4. “断开发件账户”会关闭每日邮件并删除此设备保存的发件授权。

应用从当前电脑直接通过 Gmail 的加密 SMTP 连接发送邮件，不需要额外服务器。Windows 使用当前用户的 DPAPI 加密保存应用专用密码；macOS 使用当前用户的钥匙串。密码不会返回到应用界面或状态接口，也不包含在导出备份中。更换电脑时需要重新连接发件账户。

邮件包含当前提醒范围内尚需处理的课程名称、作业名称、截止时间和课程网页链接。网页链接会移除查询参数。邮件由你自己的 Gmail 账户发往你指定的收件地址。不要把含有私人课程信息的邮件转发给无关人员。

电脑关机、睡眠或应用完全退出时无法准点发送。应用恢复后仅补发**当天**未发送的汇总；发送失败会每隔至少 30 分钟重试，最多三次。同一天成功发送一次后不会重复发送。开启全局暂停提醒或免打扰时段后，发送会延后到允许的时间；若跨日则不会补发前一天。

当前仅支持 Gmail 发件。某些学校或单位账户不允许创建应用专用密码。Outlook 等账户目前不能连接；其现代授权需要注册 OAuth 应用，并完成相应授权及可能的发布验证。Gmail OAuth 的公开应用也涉及敏感权限及验证流程，因此本版选择 Google 官方支持的应用专用密码作为本机方案。参考 [Gmail API 权限说明](https://developers.google.com/workspace/gmail/api/auth/scopes)和 [Microsoft SMTP AUTH 说明](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)。

## Setup (English)

Create a Gmail app password for an eligible account with two-step verification. In **Settings → Reminders and sync → Daily email reminders**, connect your Gmail address and app password, enter your recipient, send a test message, confirm delivery, then enable and save the daily schedule. The app never asks for your main account password. Disconnecting removes the local sender credential. Some managed accounts do not allow app passwords. Outlook sending is not supported yet. The app must be running to send on time; it catches up only within the same day.
