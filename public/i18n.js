(function exposeI18n(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UBCI18n = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  // Chinese source strings and their English equivalents live here, rather than in view logic.
  const english = {
    'UBC作业管理工具': 'UBC Assignment Manager',
    'UBC作业管理工具：本地汇总 PrairieLearn 与 WeBWorK 作业及截止提醒。': 'UBC Assignment Manager: assignments and deadline reminders from PrairieLearn and WeBWorK on your computer.',
    '跳到主要内容': 'Skip to main content', '折叠或展开课程目录': 'Toggle course list', '课程目录': 'Course list',
    '全部作业': 'All assignments', '搜索作业、课程': 'Search assignments and courses', '主导航': 'Main navigation',
    '展开目录': 'Expand course list', '目录': 'Folders', '作业日历': 'Assignment calendar',
    'PrairieLearn 作业': 'PrairieLearn assignments', 'WeBWorK 作业': 'WeBWorK assignments', '设置': 'Settings',
    '课程与来源': 'Courses and sources', '偏好': 'Preferences', '常规与窗口': 'General and window',
    '提醒与同步': 'Reminders and sync', '课程与登录': 'Courses and login', '数据与退出': 'Data and exit',
    '立即同步': 'Sync now', '尚未同步': 'Not synced yet', '作业 / 全部作业': 'Assignments / All assignments',
    '作业概览': 'Assignment overview', '按平台查看截止时间和完成状态。': 'View deadlines and completion across platforms.',
    '作业状态': 'Assignment status', '全部': 'All', '待完成': 'To do', '将开放': 'Upcoming',
    '已过日期': 'Past due', '已完成': 'Completed', '已忽略': 'Ignored', '需处理作业': 'Assignments to handle',
    '距离最近截止时间': 'Time to next deadline', '已完成作业': 'Completed assignments',
    '日历 / 月视图': 'Calendar / Month view', '按日期查看所有课程的开放、截止和手动提醒。': 'View openings, deadlines, and custom reminder dates for all courses.',
    '作业详情': 'Assignment details', '应用信息': 'App information', '应用版本': 'App version',
    '界面语言': 'Display language', '首次使用跟随设备语言；切换后立即生效。': 'Uses your device language by default. Changes take effect immediately.',
    '跟随系统': 'Follow system', '简体中文': 'Simplified Chinese',
    '后台运行': 'Background operation', '登录 Windows 后自动启动': 'Start when you sign in to Windows',
    '在当前账户登录后静默启动后台。主窗口关闭后，仍可从系统托盘重新打开。': 'Start quietly when you sign in. Reopen the window from the system tray.',
    '自动启动': 'Start automatically', '菜单栏图标': 'Menu bar icon',
    '关闭主窗口后可从菜单栏重新打开应用。隐藏图标后仍可从 Dock 或应用菜单打开和退出。': 'Reopen the app from the menu bar after closing its window. The Dock and app menu remain available when the icon is hidden.',
    '显示图标': 'Show icon', '关闭与退出': 'Close and quit', '托盘运行': 'Run in tray', '菜单栏运行': 'Run in menu bar',
    '首次使用引导': 'Getting started', '重新查看设置步骤': 'Review setup steps',
    '重新打开添加课程、专用登录窗口和首次同步说明。现有课程与作业不会被修改。': 'Review adding a course, signing in, and syncing for the first time. Existing data stays intact.',
    '打开引导': 'Open guide', '软件更新': 'Software updates', '正在检查 GitHub 更新…': 'Checking GitHub for updates…',
    '检查更新': 'Check for updates', '立即更新并重启': 'Update and restart', '下载 macOS 安装包': 'Download macOS installer',
    '未完成标记': 'Incomplete indicators', '网站图标与目录红点': 'Source icons and red dots',
    '有待完成或已过日期但仍未完成的作业时显示。可在“待完成”和“已过日期”页找到对应项目；尚未开放和已完成作业不触发。': 'A red dot appears for unfinished assignments, including overdue ones. Upcoming and completed assignments do not trigger it.',
    '红点示例': 'Red dot example', '100% 自动完成': 'Automatically complete at 100%',
    '默认将成绩达到 100% 的作业自动归入“已完成”。手动标记始终优先，并可随时恢复自动判断。': 'Assignments at 100% are completed automatically by default. Manual status takes priority and can be reset.',
    '默认启用': 'On by default', '所有完成状态需要手动确认': 'Require manual completion confirmation',
    '开启后，达到 100% 的作业仍留在“待完成”，标记为“待确认”并排在最前，直到你手动确认完成。': 'When enabled, assignments at 100% stay at the top of To do as Awaiting confirmation until you confirm them.',
    '手动确认': 'Manual confirmation', '截止提醒': 'Deadline reminders', 'macOS 系统通知': 'macOS notifications',
    '正在检查通知权限…': 'Checking notification permission…',
    '主窗口关闭后，只要应用仍在运行，就会按下方规则提醒；完全退出或关机期间不会实时提醒。': 'Reminders continue while the app is running, even with its window closed. They cannot arrive in real time while the app or computer is off.',
    '允许通知': 'Allow notifications', '发送测试通知': 'Send test notification',
    'Windows 提前提醒（小时，用逗号分隔）': 'Windows reminder lead times (hours, comma-separated)',
    '可设置 0.25 到 336 小时，最多 6 个时间点。例如 48, 24, 3。': 'Use 0.25 to 336 hours, with up to six times. Example: 48, 24, 3.',
    '启用免打扰时段': 'Enable quiet hours', '开始': 'Start', '结束': 'End', '保存提醒规则': 'Save reminder rules',
    '日期来源': 'Date source', 'WeBWorK 的开放时间只用于展示；页面公布 Due 后才按截止时间提醒。': 'WeBWorK opening times are shown for reference. Deadline alerts start once a due date is published.',
    '课程页面': 'Course page', '暂停全部提醒': 'Pause all reminders', '暂停提醒': 'Pause reminders', '按课程控制': 'Per-course controls',
    '自动同步': 'Automatic sync', '刷新间隔': 'Refresh interval',
    '完成首次同步后，应用会在后台保持专用浏览器会话，每 30 分钟尝试刷新；需要登录时可呼出窗口。': 'After the first sync, a dedicated browser session stays in the background and refreshes every 30 minutes. Open its window when sign-in is needed.',
    '30 分钟': '30 minutes', '数据新鲜度': 'Data freshness',
    '超过 6 小时未成功同步会标记为“数据可能过旧”。失败时保留原有作业，并在课程设置中显示原因和恢复入口。': 'Data is marked potentially stale after six hours without a successful sync. Existing assignments remain available, with the cause shown in course settings.',
    '6 小时': '6 hours', '立即刷新': 'Refresh now', '左下角的“立即同步”会依次更新全部课程。': 'Sync now in the lower left refreshes all courses in sequence.',
    '全部课程': 'All courses', '个人微信每日提醒': 'Daily WeChat digest', '使用': 'Use',
    'Server酱 Turbo': 'ServerChan Turbo',
    '向你的个人微信发送一条每日作业汇总。作业名称和日期会经过该服务；电脑关机或应用退出时无法发送。': 'Send a daily assignment summary to your WeChat account. Assignment names and dates pass through this service. Sending requires the app and computer to be running.',
    '粘贴以 SCT 开头的 SendKey': 'Paste a SendKey beginning with SCT', '尚未配置密钥': 'No key configured',
    '每天发送时间（电脑当地时间）': 'Daily send time (device local time)', '启用每日微信提醒': 'Enable daily WeChat reminders',
    '在微信汇总中包含个人备注': 'Include personal notes in WeChat digest',
    '默认关闭。开启后，个人备注会随作业名称和日期发送给 Server酱。': 'Off by default. When enabled, personal notes are sent to ServerChan with assignment names and dates.',
    '汇总已开放且未完成的作业。尚未开放的 WeBWorK 作业不会被当作截止提醒。如果今天的时间已过，启用后会发送一次今日汇总。': 'The digest includes open, unfinished assignments. Future WeBWorK assignments do not trigger deadline alerts. If today’s send time has passed, enabling it sends today’s digest once.',
    '保存设置': 'Save settings', '发送测试消息': 'Send test message', '清除密钥': 'Clear key',
    '计划与发送记录': 'Schedule and history', '下一次每日汇总': 'Next daily digest', '每日汇总未启用。': 'Daily digest is off.',
    '设备时区': 'Device time zone', '所有计划时间均按当前电脑设置解释。': 'All scheduled times use your device settings.',
    '尚无发送记录。': 'No delivery history yet.', '添加课程': 'Add course',
    '支持 PrairieLearn 的 Assessments 页面和 UBC WeBWorK 课程首页。': 'Supports PrairieLearn Assessments pages and UBC WeBWorK course home pages.',
    '课程网址': 'Course URL', '已添加课程': 'Added courses',
    '作业类别来自课程页面的分组标题。请根据 syllabus 自行决定是否忽略；应用不会根据名称推断类别是否计分。忽略后仍保留成绩、日期和手动设置，但不进入默认列表、计数、红点或任何提醒。': 'Assignment categories come from course page headings. Check the syllabus before ignoring one; the app does not infer grading from its name. Ignored assignments keep their grades, dates, and manual settings but leave the default list, counts, dots, and reminders.',
    '登录与手动导入': 'Login and manual import',
    '登录窗口使用独立 Edge 资料。登录完成后可隐藏窗口，再从后台同步课程。': 'The sign-in window uses a separate Edge profile. After signing in, hide the window and sync in the background.',
    '选择课程': 'Choose course', '打开登录窗口': 'Open sign-in window', '隐藏登录窗口': 'Hide sign-in window',
    '登录窗口已隐藏，后台同步可继续。': 'Sign-in window hidden; background sync can continue.',
    '请等待课程同步完成后再打开登录窗口。': 'Wait for course sync to finish before opening the sign-in window.',
    '请等待课程同步完成后再隐藏登录窗口。': 'Wait for course sync to finish before hiding the sign-in window.',
    '请先关闭该工具专用的 Edge 登录窗口，再重试。': 'Close this app’s dedicated Edge sign-in window, then try again.',
    'Edge 已启动，但无法连接。请关闭该工具专用的 Edge 窗口后重试。': 'Edge started, but the app could not connect. Close this app’s dedicated Edge window and try again.',
    'PrairieLearn 页面无法同步？粘贴作业表格': 'PrairieLearn not syncing? Paste the assignment table',
    '在已登录的浏览器中复制 PrairieLearn 作业表格，粘贴到下方导入。WeBWorK 请使用登录窗口同步。': 'Copy the PrairieLearn assignment table from a signed-in browser and paste it below. Sync WeBWorK through the sign-in window.',
    '作业表格文字': 'Assignment table text', '导入所选课程': 'Import into selected course',
    '备份与恢复': 'Backup and restore',
    '备份包含课程、缓存作业、优先级、个人备注、手动完成状态、手动提醒日期和普通设置。不会包含 Server酱 SendKey、Cookie、Edge 登录资料、发送记录；课程和作业网址中的查询参数会移除。': 'Backups include courses, cached assignments, priorities, notes, manual completion and reminder dates, and ordinary settings. They exclude the ServerChan SendKey, cookies, Edge profile, and delivery history. URL query parameters are removed.',
    '导出 JSON 备份': 'Export JSON backup', '适合换电脑或在重要修改前保存。文件带有格式版本和内容范围说明。': 'Useful when changing computers or before major changes. The file includes a format version and scope.',
    '导出备份': 'Export backup', '选择备份文件': 'Select backup file',
    '选择文件': 'Choose file', '未选择文件': 'No file selected',
    '导入会替换当前课程、作业和普通设置；写入前会在本机自动创建恢复点。现有 SendKey 和浏览器登录资料不会从文件导入，也不会被删除。': 'Import replaces courses, assignments, and ordinary settings after creating a local restore point. Your SendKey and browser sign-in data are neither imported nor deleted.',
    '验证并恢复': 'Validate and restore', '本地数据': 'Local data', '退出应用': 'Quit app',
    '发现新版本': 'New version available', '稍后': 'Later', '首次设置': 'Initial setup',
    '添加你的课程': 'Add your course',
    '粘贴学生作业列表网址。应用支持 PrairieLearn Assessments 页面和 UBC WeBWorK 课程首页。': 'Paste the student assignment list URL. PrairieLearn Assessments and UBC WeBWorK course home pages are supported.',
    '稍后设置': 'Set up later', '在专用 Edge 窗口登录': 'Sign in through the dedicated Edge window',
    '这个窗口使用独立的本地登录资料，不会继承日常浏览器的登录状态。完成学校登录并停留在作业列表页，再返回这里同步。': 'This window has its own local sign-in profile and does not use your regular browser session. Sign in and leave the assignment list open, then return here to sync.',
    '我已登录，立即同步': 'I’m signed in, sync now', '首次同步完成': 'First sync complete',
    '完成，稍后配置微信': 'Finish; set up WeChat later', '前往提醒设置': 'Go to reminder settings',
    '修改提醒日期': 'Change reminder date', '电脑当地时间': 'Device local time', '恢复网页日期': 'Restore website date',
    '取消': 'Cancel', '保存': 'Save', '应用通知': 'App notice', '请选择': 'Please choose',
    '需要注意': 'Attention', '重要确认': 'Confirmation required', '知道了': 'Got it', '确认': 'Confirm',
    '处理中…': 'Working…', '操作失败，请重试。': 'Action failed. Please try again.', '操作失败。': 'Action failed.',
    '弹窗通知必须包含 ID。': 'A notification must have an ID.',
    '高优先级': 'High priority', '中优先级': 'Medium priority', '低优先级': 'Low priority',
    '需要重新登录': 'Sign in again', '网络连接失败': 'Network connection failed',
    '页面解析失败': 'Could not read page', '页面不匹配': 'Unexpected page', '同步失败': 'Sync failed',
    '用户手动设置': 'Set manually', '成绩达到 100%': 'Score reached 100%',
    '成绩达到 100%，等待手动确认': 'Score reached 100%; awaiting confirmation',
    '课程网站状态': 'Course website status', '网站未提供可靠状态': 'Website did not provide a reliable status',
    '未完成': 'Incomplete', '待确认': 'Awaiting confirmation', '完成中': 'In progress',
    '已截止': 'Closed', '未知': 'Unknown', '暂无日期': 'No date available',
    '等待确认课程归属': 'Waiting for course ownership confirmation', '正在同步…': 'Syncing…',
    '正在同步': 'Syncing', '尚无可用缓存': 'No cached data available', '尚未成功同步': 'Never synced successfully',
    '数据可能过旧': 'Data may be stale', '上次同步': 'Last synced',
    '开放时间': 'Opens', '网页标记已截止': 'Marked closed by website',
    '手动提醒日期': 'Custom reminder date', '当前得分阶段结束': 'Current credit window ends',
    '截止时间': 'Due', '网页没有显示截止时间': 'No due date shown on website',
    '暂无成绩': 'No score', '有个人备注': 'Has a personal note', '恢复管理': 'Include again',
    '改日期': 'Change date', '标为未完成': 'Mark incomplete', '标为完成': 'Mark complete',
    '作业': 'Assignment', '日期': 'Date', '状态': 'Status', '成绩': 'Score',
    '截止': 'Due', '开放': 'Opens', '手动日期': 'Custom date', '今天': 'Today',
    '上个月': 'Previous month', '下个月': 'Next month',
    '日': 'Sun', '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat',
    '个人安排': 'Personal plan', '仅保存在本机': 'Saved only on this computer',
    '优先级': 'Priority', '未设置': 'Not set', '个人备注': 'Personal note',
    '记录准备事项、复习范围或提交说明': 'Record preparation, revision, or submission notes',
    '保存安排': 'Save plan', '清空备注': 'Clear note', '撤销未保存更改': 'Undo unsaved changes',
    '个人安排已保存。': 'Personal plan saved.',
    '选择一项作业，即可在这里查看日期、成绩和操作。': 'Select an assignment to view its date, score, and actions.',
    '来源': 'Source', '列表状态': 'List status', '完成状态': 'Completion status',
    '判断来源': 'Status source', '题目完成': 'Problems completed', '分类': 'Category',
    '成绩已达到 100%。当前启用了手动确认模式，请确认后将作业标为完成。': 'The score is 100%. Manual confirmation is enabled; mark this assignment complete when ready.',
    '课程网站没有提供可靠的完成结论，请根据实际提交情况手动确认。': 'The course website did not give a reliable completion status. Confirm based on your submission.',
    '今天到期。': 'Due today.', '网页显示的日期已经过去。': 'The date shown on the website has passed.',
    '截止信息会随平台同步更新。': 'Deadline information updates when the source syncs.',
    '网页没有显示明确截止时间。你可以手动设置提醒日期。': 'No clear due date is shown on the website. You can set a custom reminder date.',
    '确认这门课程属于你之后，才能打开课程网站。': 'Confirm that this course belongs to you before opening its website.',
    '原始成绩、日期和手动设置仍保留。': 'Original scores, dates, and manual settings are retained.',
    '恢复管理此类别': 'Include this category again', '恢复网站判断': 'Restore website status',
    '将两个平台的待办和成绩汇总到同一工作区。': 'Assignments and scores from both platforms in one workspace.',
    '查看这个平台的课程和作业。': 'View courses and assignments from this platform.',
    '还没有课程': 'No courses yet', '还没有完成首次同步': 'First sync not completed',
    '同步完成，但没有发现可见作业': 'Sync completed, but no visible assignments were found',
    '所有任务均已完成': 'All assignments are complete', '没有匹配的作业': 'No matching assignments',
    '当前分类暂无作业': 'No assignments in this category', '暂无作业': 'No assignments',
    '添加 PrairieLearn Assessments 页面或 UBC WeBWorK 课程首页，即可开始。': 'Add a PrairieLearn Assessments page or UBC WeBWorK course home page to begin.',
    '请打开专用 Edge 登录窗口，完成学校登录并停留在作业列表页，然后返回应用同步。': 'Sign in through the dedicated Edge window, leave the assignment list open, then return here to sync.',
    '连接已经成功，但课程页面目前没有可见作业。可检查页面内容和登录状态后再次同步。': 'The course connected, but its page has no visible assignments. Check the page and sign-in status, then sync again.',
    '当前课程的任务均已完成。': 'All assignments in this course are complete.',
    '没有找到符合搜索内容的作业，可以清除搜索后查看当前列表。': 'No assignments match this search. Clear the search to see the current list.',
    '当前课程在此分类中没有可显示的作业。': 'This course has no assignments to display in this category.',
    '课程中暂时没有可显示的作业。': 'This course has no assignments to display right now.',
    '清除搜索': 'Clear search', '开始添加课程': 'Add your first course',
    '前往登录与同步': 'Go to login and sync', '重新同步': 'Sync again',
    '即将截止': 'Due soon', '已忽略的作业': 'Ignored assignments', '最近完成': 'Recently completed',
    '课程连接已经成功，但当前页面没有发现可见作业。你可以完成引导，并在课程发布作业后重新同步。': 'The course connected, but its page has no visible assignments. Finish setup and sync again when assignments are published.',
    '无法读取开机启动状态。': 'Could not read startup status.',
    '正在检查通知权限…': 'Checking notification permission…',
    '通知已允许，应用运行时可发送截止提醒。': 'Notifications are allowed. Deadline alerts can be sent while the app is running.',
    '通知已被系统拒绝。请在“系统设置 → 通知”中允许此应用。': 'Notifications are blocked. Allow this app in System Settings → Notifications.',
    '尚未授权通知。请点击“允许通知”。': 'Notifications have not been allowed. Select Allow notifications.',
    '无法读取系统通知状态。': 'Could not read notification status.',
    '提前提醒（小时，用逗号分隔）': 'reminder lead times (hours, comma-separated)',
    '免打扰期间不会弹出': 'During quiet hours, there will be no',
    '通知或发送每日微信汇总；应用恢复或时段结束后只补发当天尚未成功的汇总，不补发往日消息。': 'notifications or WeChat digests. The app sends only a missed digest for today after resuming or when quiet hours end.',
    '截止提醒和每日微信汇总；课程自动同步仍会继续。': 'deadline alerts and daily WeChat digests; automatic course syncing continues.',
    '关闭后，该课程不会进入': 'When off, this course is excluded from',
    '截止通知或微信每日汇总。': 'deadline notifications and daily WeChat digests.',
    '已为当前 Windows 账户启用。': 'Enabled for this Windows account.', '当前未启用。': 'Currently disabled.',
    '尚未添加课程。': 'No courses added yet.', '重新登录': 'Sign in again', '打开登录': 'Open sign-in',
    '登录窗口已打开。完成登录后点击“重试同步”。': 'The sign-in window is open. After signing in, select Retry sync.',
    '重试同步': 'Retry sync', '移除': 'Remove',
    '课程页面尚未提供可区分的作业类别。': 'The course page has no distinct assignment categories yet.',
    '添加课程后可在这里分别控制提醒。': 'Add a course to control its reminders here.',
    '密钥已保存在本机；留空可保持现有密钥。': 'Key saved on this computer. Leave blank to keep it.',
    '尚未配置密钥。请使用 Server酱 Turbo 的 SCT SendKey。': 'No key configured. Use a ServerChan Turbo SCT SendKey.',
    '全部提醒已暂停。': 'All reminders are paused.',
    '已启用，等待下次发送时间。': 'Enabled; waiting for the next send time.',
    '每日提醒尚未启用。': 'Daily reminders are off.',
    '提醒已暂停；恢复后若仍是当天且计划时间已过，会发送当天尚未成功的汇总。': 'Reminders are paused. If resumed later today, an unsent digest for today will be sent.',
    '每日微信汇总尚未启用。': 'Daily WeChat digest is off.', '请先保存 Server酱 SendKey。': 'Save a ServerChan SendKey first.',
    '计划按电脑当地时间执行。': 'Scheduled in device local time.',
    '自动汇总': 'Automatic digest', '手动测试': 'Manual test', 'Windows 通知': 'Windows notification',
    'macOS 通知': 'macOS notification', '服务已接受': 'Accepted by service', '发送失败': 'Send failed',
    '已交给系统显示': 'Handed to system for display',
    '尚未检查更新。': 'No update check yet.', '当前已是最新版本。': 'You have the latest version.',
    '暂时没有可安装的发布包。': 'No installable release package is available yet.',
    '更新检查失败。': 'Update check failed.', '正在下载安装更新包…': 'Downloading and installing update…',
    '发现新版本。请下载对应架构的 .pkg 并手动安装。': 'A new version is available. Download the .pkg for your Mac and install it manually.',
    '发现新版本。当前位于 Git 开发目录，请在独立的便携包中使用应用内更新。': 'A new version is available. In-app updates work in the standalone portable package.',
    '更新状态未知。': 'Update status unknown.',
    '确认本机课程': 'Confirm your courses',
    '检测到旧版本或备份中的课程。为防止打开课程网址时被 PrairieLearn 自动加入课程，请只勾选你当前确实参加的课程。未勾选课程及其本地作业记录会被移除。': 'Courses from an older version or backup were found. To avoid joining a PrairieLearn course just by opening its URL, select only courses you currently take. Unselected courses and their local assignment records will be removed.',
    '确认前，这些课程不会打开网页、同步数据或发送提醒。': 'These courses will not open pages, sync, or send reminders until confirmed.',
    '如果暂时无法确认，可以选择“稍后处理”。': 'If you cannot confirm now, choose Later.',
    '稍后处理': 'Later', '确认并应用': 'Confirm and apply',
    '课程已添加。请打开登录窗口，完成登录后同步。': 'Course added. Open the sign-in window, then sync after signing in.',
    '请输入有效的提前小时数。': 'Enter valid reminder lead times in hours.',
    '提醒规则已保存，下次发送时间已更新。': 'Reminder rules saved; next send time updated.',
    '已启用登录 Windows 后自动启动。': 'Start on Windows sign-in enabled.',
    '已关闭登录 Windows 后自动启动。': 'Start on Windows sign-in disabled.',
    '已提交 macOS 测试通知，请查看系统通知中心。': 'Test notification submitted. Check macOS Notification Center.',
    '已启用手动确认，100% 作业会置顶等待确认。': 'Manual confirmation enabled. Assignments at 100% will appear first for confirmation.',
    '已恢复自动判断，100% 作业会自动完成。': 'Automatic completion restored for assignments at 100%.',
    '全部提醒已暂停，课程同步会继续。': 'All reminders paused; course syncing continues.',
    '提醒已恢复。': 'Reminders resumed.', '微信提醒设置已保存。': 'WeChat reminder settings saved.',
    '正在发送…': 'Sending…', '清除本机保存的微信推送密钥，并关闭每日提醒？': 'Clear the saved WeChat key and disable daily reminders?',
    '密钥已清除，每日微信提醒已关闭。': 'Key cleared; daily WeChat reminders disabled.',
    '文件超过 5 MB，无法导入。': 'File exceeds 5 MB and cannot be imported.',
    '文件格式或版本不受支持。': 'Unsupported file format or version.',
    '确认用这份备份替换当前课程、作业和普通设置？应用会先创建本机恢复点。': 'Replace current courses, assignments, and ordinary settings with this backup? A local restore point will be created first.',
    '恢复完成。本机已保留导入前恢复点。请重新登录课程；微信凭证未从备份导入。': 'Restore complete. A pre-import restore point remains on this computer. Sign in to courses again; WeChat credentials were not imported.',
    '请先选择日期和时间。': 'Choose a date and time first.',
    '关闭主窗口只会隐藏窗口，课程同步与提醒继续运行。请使用系统托盘或“数据与退出”页面退出应用。': 'Closing the main window hides it while syncing and reminders continue. Quit from the tray or Data and exit settings.',
    '应用通过 GitHub 公共 HTTPS API 检查并下载更新，无需安装 GitHub CLI 或登录 GitHub。临时网络错误会自动重试；更新会保留当前 Windows 账户下的课程、作业与提醒数据。': 'The app checks and downloads updates through GitHub’s public HTTPS API. GitHub CLI and sign-in are unnecessary. Temporary network errors are retried; your local course and reminder data are preserved.',
    '作业清单、提醒设置与专用 Edge 登录资料保存在当前 Windows 账户的本地应用数据目录中，覆盖升级不会删除。关闭网页不会停止后台提醒。': 'Assignments, reminder settings, and the dedicated Edge profile are stored in this Windows account’s local app data. Updating does not remove them. Closing the window does not stop background reminders.',
    '作业清单、提醒设置与专用 Edge 登录资料保存在当前 Mac 账户的“应用程序支持”目录中，覆盖升级不会删除。关闭主窗口不会停止后台提醒。': 'Assignments, reminder settings, and the dedicated Edge profile are stored in this Mac account’s Application Support folder. Updating does not remove them. Closing the main window does not stop background reminders.',
    '停止后台同步和 Windows 提醒。下次可双击 UBC作业管理工具.exe 重新打开。': 'Stop background syncing and Windows reminders. Double-click the UBC Assignment Manager executable to reopen.',
    '停止后台同步和 macOS 系统通知。下次可从“应用程序”重新打开。': 'Stop background syncing and macOS notifications. Reopen from Applications.',
    '关闭主窗口后应用可继续运行，并从菜单栏重新打开。完全退出请使用应用菜单或“数据与退出”。': 'The app continues running after its main window closes. Reopen from the menu bar, or quit from the app menu or Data and exit.',
    '应用通过 GitHub 公共 HTTPS API 检查更新。Mac 版下载对应架构的 .pkg 后手动安装；课程、作业与提醒设置保存在独立数据目录。': 'The app checks updates through GitHub’s public HTTPS API. On Mac, download the .pkg for your architecture and install it manually. Your local data is stored separately.',
    '尚未添加课程': 'No courses added', '每日提醒未启用': 'Daily reminders off',
    '每日提醒已启用': 'Daily reminders on', '每日提醒发送失败': 'Daily reminder failed',
    '提醒已暂停': 'Reminders paused',
    'PrairieLearn 示例：…/pl/course_instance/数字/assessments': 'PrairieLearn example: …/pl/course_instance/number/assessments',
    'WeBWorK 示例：webwork.elearning.ubc.ca/webwork2/课程名': 'WeBWorK example: webwork.elearning.ubc.ca/webwork2/course-name',
    'Windows 截止提醒可以直接使用；个人微信每日汇总是可选功能，稍后也能在设置中配置。': 'Windows deadline reminders are ready to use. The daily WeChat digest is optional and can be configured later.',
    'macOS 截止提醒可在提醒设置中启用；个人微信每日汇总也是可选功能。': 'Enable macOS deadline alerts in Reminder settings. The daily WeChat digest is also optional.',
    '同步完成。': 'Sync complete.', '打开浏览器': 'Open browser',
    '暂停 Windows 截止提醒和每日微信汇总；课程自动同步仍会继续。': 'Pause Windows deadline alerts and daily WeChat digests; automatic course syncing continues.',
    '暂停 macOS 截止提醒和每日微信汇总；课程自动同步仍会继续。': 'Pause macOS deadline alerts and daily WeChat digests; automatic course syncing continues.',
    '专用 Edge 窗口尚未登录': 'Not signed in to the dedicated Edge window',
    'Server酱已接受测试消息': 'ServerChan accepted the test message',
    'Server酱已接受测试消息，请在微信中确认实际接收。': 'ServerChan accepted the test message. Check WeChat for delivery.',
    '在专用 Edge 窗口中完成登录后重试。': 'Sign in through the dedicated Edge window, then retry.',
    '请求内容过大。': 'Request body is too large.', 'JSON 格式错误。': 'Invalid JSON.',
    '课程不存在。': 'Course not found.', '这门课程正在同步，请稍等。': 'This course is syncing. Please wait.',
    '提醒项目已过期或无效。': 'Reminder item has expired or is invalid.',
    '提醒暂停状态无效。': 'Invalid reminder pause status.',
    '提前提醒时间应为 0.25 到 336 小时。': 'Reminder lead time must be between 0.25 and 336 hours.',
    '免打扰时间无效。': 'Invalid quiet hours.', '免打扰设置无效。': 'Invalid quiet-hours setting.',
    '课程提醒设置无效。': 'Invalid per-course reminder setting.', '没有可保存的提醒设置。': 'No reminder settings to save.',
    '语言设置无效。': 'Invalid language setting.', '完成确认设置无效。': 'Invalid completion confirmation setting.',
    '首次使用引导状态无效。': 'Invalid onboarding status.', '没有可保存的设置。': 'No settings to save.',
    '请输入有效的每日提醒时间。': 'Enter a valid daily reminder time.',
    '启用状态无效。': 'Invalid enabled status.', '微信备注设置无效。': 'Invalid WeChat note setting.',
    '请先保存 SCT SendKey。': 'Save an SCT SendKey first.', '正在发送微信提醒，请稍后重试。': 'Sending a WeChat reminder. Please try again shortly.',
    '这门课已经添加。': 'This course has already been added.', '课程类别设置无效。': 'Invalid course category setting.',
    '这门课程中没有找到该类别。': 'Category not found in this course.',
    'WeBWorK 请使用登录窗口同步；此处的文字导入仅支持 PrairieLearn。': 'Use the sign-in window to sync WeBWorK. This text import supports PrairieLearn only.',
    '未识别到作业。请从作业表格复制包含 LAB03 等代码的行。': 'No assignments recognized. Copy rows from the assignment table, including codes such as LAB03.',
    '作业不存在。': 'Assignment not found.', '完成状态无效。': 'Invalid completion status.',
    '日期格式无效。': 'Invalid date format.', '作业优先级无效。': 'Invalid assignment priority.',
    '个人备注无效。': 'Invalid personal note.', '未找到。': 'Not found.', '服务器错误。': 'Server error.',
    '未找到 Microsoft Edge。请先安装 Edge，再在应用中打开课程登录窗口。': 'Microsoft Edge was not found. Install Edge, then open the course sign-in window in the app.',
    '未找到 Microsoft Edge。': 'Microsoft Edge was not found.',
    'Edge 已打开，但无法连接。请关闭该工具专用的 Edge 窗口后重试。': 'Edge is open, but the app cannot connect. Close the dedicated Edge window and try again.',
    '无法读取 Edge 页面列表。': 'Could not read Edge tabs.', '无法打开课程页面。': 'Could not open the course page.',
    '无法连接课程页面。': 'Could not connect to the course page.',
    '无法读取 WeBWorK 作业详情，请确认登录仍然有效。': 'Could not read WeBWorK assignment details. Confirm that you are still signed in.',
    '请先在课程确认弹窗中确认这门课程属于你。': 'Confirm that this course belongs to you in the course confirmation dialog first.',
    '课程确认内容无效。': 'Invalid course confirmation.', '课程确认内容包含无效课程。': 'Course confirmation includes an invalid course.',
    '请输入有效的 HTTPS 课程网址。': 'Enter a valid HTTPS course URL.',
    '请输入 WeBWorK 课程首页网址。': 'Enter the WeBWorK course home page URL.',
    'WeBWorK 课程网址无效。': 'Invalid WeBWorK course URL.',
    '请使用 PrairieLearn 或 UBC WeBWorK 的 HTTPS 课程网址。': 'Use an HTTPS course URL from PrairieLearn or UBC WeBWorK.',
    '网址应以 /pl/course_instance/课程ID/assessments 结尾。': 'The URL must end in /pl/course_instance/course-ID/assessments.',
    '没有读到作业表格，原有数据已保留。': 'No assignment table was found. Existing data was preserved.',
    '没有读到 WeBWorK 作业，原有数据已保留。': 'No WeBWorK assignments were found. Existing data was preserved.',
    '没有识别到有效的 WeBWorK 作业，原有数据已保留。': 'No valid WeBWorK assignments were recognized. Existing data was preserved.',
    'WeBWorK 作业详情页没有可读取的题目表格。': 'The WeBWorK assignment page has no readable problem table.',
    'WeBWorK 作业详情页包含无法识别的题目完成度。': 'The WeBWorK assignment page has an unrecognized problem completion value.',
    'WeBWorK 作业详情页没有识别到 Status 列。': 'The WeBWorK assignment page has no recognized Status column.',
    '微信提醒设置无效。': 'Invalid WeChat reminder settings.',
    '请输入 Server酱 Turbo 的 SCT SendKey。': 'Enter a ServerChan Turbo SCT SendKey.',
    '备份包含不受支持的网址。': 'Backup contains an unsupported URL.', '备份文件不是有效对象。': 'Backup file is not a valid object.',
    '备份格式或版本不受支持。': 'Unsupported backup format or version.',
    '备份缺少课程或作业数据。': 'Backup is missing courses or assignments.',
    '备份内容超出允许范围。': 'Backup exceeds allowed limits.',
    '课程编号与网址不一致。': 'Course ID does not match its URL.',
    '备份包含重复课程。': 'Backup contains duplicate courses.',
    '作业引用了不存在的课程。': 'An assignment references a missing course.',
    '作业编号无效。': 'Invalid assignment ID.', '手动完成状态无效。': 'Invalid manual completion status.',
    '网站完成状态无效。': 'Invalid website completion status.', '得分比例无效。': 'Invalid credit percentage.',
    '截止类型无效。': 'Invalid deadline type.', '作业来源状态无效。': 'Invalid source assignment status.',
    '备份包含重复作业。': 'Backup contains duplicate assignments.',
    '个人作业数据无效。': 'Invalid personal assignment data.',
    '个人作业数据超出允许范围。': 'Personal assignment data exceeds allowed limits.',
    '个人作业数据引用无效。': 'Invalid personal assignment reference.',
    '更新正在进行，请稍等。': 'Update in progress. Please wait.',
    'Mac 版请下载对应架构的 .pkg 手动安装更新。': 'On Mac, download the .pkg for your architecture and install it manually.',
    '当前在 Git 开发目录运行。请先使用独立的便携包，避免更新覆盖源码。': 'The app is running from a Git development folder. Use the standalone portable package to avoid overwriting source code.',
    '当前没有可安装的新版本。': 'No installable new version is available.',
    '更新包的校验文件格式无效。': 'Invalid update checksum file.',
    '更新包校验失败，安装已取消。': 'Update checksum failed; installation was canceled.',
    '无法启动更新安装程序。': 'Could not start the update installer.',
    '更新包已验证，应用即将关闭、安装并重新启动。': 'Update verified. The app will close, install, and restart.',
    '开机启动状态无效。': 'Invalid startup status.', '开机启动仅支持 Windows。': 'Start at login is supported on Windows only.',
    '当前目录缺少 UBC作业管理工具.exe，请先生成或重新解压完整应用。': 'The UBC Assignment Manager executable is missing. Build or fully extract the app first.',
    'Server酱返回了无法识别的结果。': 'ServerChan returned an unrecognized response.',
    '无法连接 Server酱，请检查网络后重试。': 'Could not connect to ServerChan. Check your connection and try again.',
    '连接 Server酱超时，请检查网络后重试。': 'ServerChan connection timed out. Check your network and try again.',
    '无法解析 Server酱域名，请检查 DNS 或网络连接。': 'Could not resolve the ServerChan domain. Check DNS or your network.',
    '无法连接 Server酱：当前应用的网络访问被系统或运行环境拒绝。请检查防火墙或从桌面重新启动应用。': 'ServerChan connection was blocked by the system or runtime. Check your firewall or restart the app from the desktop.',
    '提醒已记录。': 'Reminder recorded.', '同步已在进行。': 'Sync is already in progress.',
    '已开始同步课程。': 'Course sync started.', '主窗口已打开。': 'Main window opened.',
    '应用已退出。': 'App closed.',
    '同步等待页面超时。请确认专用 Edge 已登录并停留在作业列表页。': 'Timed out waiting for the assignment page. Confirm that the dedicated Edge window is signed in and on the assignment list.',
    '同步等待页面超时。请确认专用 Edge 已登录并停留在作业列表页，然后重试。': 'Timed out waiting for the assignment page. Confirm that the dedicated Edge window is signed in and on the assignment list, then retry.',
    '等待 PrairieLearn 页面超时。': 'Timed out waiting for the PrairieLearn page.',
    '页面响应过大。': 'Page response was too large.', 'Edge 已关闭调试连接。': 'Edge closed the connection.',
    'Edge 连接中断。': 'Edge connection interrupted.',
    '当前页面没有作业表格。请先在 Edge 中登录 PrairieLearn，并打开课程的 Assessments 页面。': 'No assignment table was found on this page. Sign in to PrairieLearn in Edge and open the course Assessments page.',
    '没有读取到页面内容。': 'No page content was read.', '读取页面时发生脚本错误。': 'A script error occurred while reading the page.',
    '作业页面已打开，但没有识别到作业行；页面结构可能已变化。': 'The assignment page opened, but no rows were recognized. Its layout may have changed.',
    '专用 Edge 窗口尚未登录，或仍停留在登录跳转页面。': 'The dedicated Edge window is not signed in or remains on a login redirect.',
    '尚未读取到 WeBWorK 页面。': 'No WeBWorK page has been read yet.',
    '已打开 WeBWorK，但未识别到作业。请确认课程的作业列表已加载。': 'WeBWorK opened, but no assignments were recognized. Confirm that the course assignment list has loaded.',
    '已打开 WeBWorK，但未看到作业列表。请先登录并打开课程首页。': 'WeBWorK opened, but the assignment list is missing. Sign in and open the course home page.',
    '专用 Edge 窗口尚未登录 WeBWorK，或仍停留在学校登录页面。': 'The dedicated Edge window is not signed in to WeBWorK or remains on the school login page.',
    'Server酱请求失败': 'ServerChan request failed', 'Server酱未接受消息': 'ServerChan did not accept the message',
  };

  let language = 'auto';
  let configured = false;
  let systemLocale = typeof navigator === 'object' ? navigator.language : Intl.DateTimeFormat().resolvedOptions().locale;
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  const phrases = Object.entries(english).sort((a, b) => b[0].length - a[0].length);
  const patterns = [
    [/^已恢复 (\d+) 门课程和 (\d+) 项作业。请重新登录课程(并重新启用每日微信汇总)?。$/, (_, courses, tasks, wechat) => `Restored ${courses} courses and ${tasks} assignments. Sign in to the courses again${wechat ? ' and re-enable the daily WeChat digest' : ''}.`],
    [/^已确认 (\d+) 门课程，移除 (\d+) 门未选择课程。$/, (_, kept, removed) => `Confirmed ${kept} courses and removed ${removed} unselected courses.`],
    [/^Edge 已打开。请登录 (WeBWorK|PrairieLearn)，然后回到应用点击“同步”。$/, (_, platform) => `Edge is open. Sign in to ${platform}, then return to the app and sync.`],
    [/^已同步 (\d+) 项作业。$/, (_, count) => `Synced ${count} assignments.`],
    [/^已从复制的表格导入 (\d+) 项作业。$/, (_, count) => `Imported ${count} assignments from the copied table.`],
    [/^Edge 拒绝调试连接（(.+)）。$/, (_, code) => `Edge refused the connection (${code}).`],
    [/^无法读取 (.+) 的题目完成度，请重新登录 WeBWorK。$/, (_, name) => `Could not read problem progress for ${name}. Sign in to WeBWorK again.`],
    [/^Server酱请求失败（HTTP (\d+)）。$/, (_, status) => `ServerChan request failed (HTTP ${status}).`],
    [/^Server酱未接受消息（代码 (.+)）。$/, (_, code) => `ServerChan did not accept the message (code ${code}).`],
    [/^距离当前日期还有 (\d+) 天。截止信息会随平台同步更新。$/, (_, days) => `${days} days until the displayed date. Deadline information updates when the source syncs.`],
    [/^(.+)：(.+)；保留 (.+) 的数据$/, (_, label, detail, date) => `${translate(label)}: ${translate(detail)}; cached data from ${date}`],
    [/^(.+) · (\d+(?:\.\d+)?) 小时内截止$/, (_, name, hours) => `${name} · due within ${hours} hours`],
    [/^当前界面：(.+)$/, (_, value) => `Current view: ${translate(value)}`],
    [/^设置 \/ (.+)$/, (_, value) => `Settings / ${translate(value)}`],
    [/^作业 \/ (.+)$/, (_, value) => `Assignments / ${translate(value)}`],
    [/^日历 \/ (.+)$/, (_, value) => `Calendar / ${translate(value)}`],
    [/^(\d+) 项需处理$/, (_, count) => `${count} need attention`],
    [/^(\d+) 项$/, (_, count) => `${count} items`],
    [/^(\d+) 天$/, (_, count) => `${count} days`],
    [/^第 (\d+) 步，共 (\d+) 步$/, (_, current, total) => `Step ${current} of ${total}`],
    [/^查看 (.+) 的详情$/, (_, name) => `View details for ${name}`],
    [/^成绩 (\d+(?:\.\d+)?)%$/, (_, score) => `Score ${score}%`],
    [/^(\d+) 项作业尚未公布有效日期，可在“全部作业”中查看。$/, (_, count) => `${count} assignments have no published date. View them in All assignments.`],
    [/^距离当前日期还有 (\d+) 天。$/, (_, days) => `${days} days until the current date.`],
    [/^在 (PrairieLearn|WeBWorK) 中打开 ↗$/, (_, name) => `Open in ${name} ↗`],
    [/^“(.+)”类别已由你设为忽略。原始成绩、日期和手动设置仍保留。$/, (_, name) => `You ignored the “${name}” category. Original scores, dates, and manual settings are retained.`],
    [/^当前已开放的任务都已完成；另有 (\d+) 项尚未开放，可在“将开放”中查看。$/, (_, count) => `All open assignments are complete. ${count} more are upcoming.`],
    [/^下一步连接 (.+)。先打开登录窗口，再回到这里同步作业。$/, (_, name) => `Next, connect ${name}. Open the sign-in window, then return here to sync.`],
    [/^已读取 (\d+) 项作业，你可以在主界面查看截止时间和成绩。$/, (_, count) => `Read ${count} assignments. View deadlines and scores on the main screen.`],
    [/^(\d+) 门课程同步失败，请在课程设置中查看。$/, (_, count) => `${count} courses failed to sync. Check course settings.`],
    [/^已读取 (\d+) 项。$/, (_, count) => `Read ${count} assignments.`],
    [/^移除 (.+) 及其本地作业记录？$/, (_, name) => `Remove ${name} and its local assignment records?`],
    [/^已恢复管理 (.+)。$/, (_, name) => `Including ${name} again.`],
    [/^已忽略 (.+)，该类别不再触发提醒。$/, (_, name) => `Ignored ${name}; this category no longer triggers reminders.`],
    [/^管理 (.+)$/, (_, name) => `Include ${name}`],
    [/^已启用 (.+) 的提醒。$/, (_, name) => `Reminders enabled for ${name}.`],
    [/^已关闭 (.+) 的提醒。$/, (_, name) => `Reminders disabled for ${name}.`],
    [/^上次每日提醒：(.+)$/, (_, date) => `Last daily reminder: ${date}`],
    [/^上次测试：(.+)$/, (_, date) => `Last test: ${date}`],
    [/^上次发送失败：(.+)$/, (_, error) => `Last send failed: ${translate(error)}`],
    [/^首次发送不早于 (.+)（电脑当地时间）$/, (_, date) => `First send no earlier than ${date} (device local time)`],
    [/^免打扰 (.+)；时段内的当天汇总将在结束后补发。$/, (_, range) => `Quiet hours ${range}; today’s digest will be sent afterward.`],
    [/^发现新版本 (.+)。$/, (_, version) => `New version ${version} available.`],
    [/^上次更新 (.+) 失败，已恢复旧版：(.+)$/, (_, version, reason) => `Update to ${version} failed; restored previous version: ${translate(reason)}`],
    [/^已发现 (.+)。现在更新会关闭应用，安装完成后自动重新打开；本地作业和提醒设置会保留。$/, (_, name) => `${name} is available. Updating closes and restarts the app. Local assignments and reminder settings are preserved.`],
    [/^(\d+) 门课程同步失败$/, (_, count) => `${count} courses failed to sync`],
    [/^(\d+) 门课程数据需要更新$/, (_, count) => `${count} courses need fresh data`],
    [/^(\d+) 门同步失败$/, (_, count) => `${count} sync failures`],
    [/^(\d+) 门数据可能过旧$/, (_, count) => `${count} courses may be stale`],
    [/^PrairieLearn (\d+) 门课程 · WeBWorK (\d+) 门课程$/, (_, pl, ww) => `PrairieLearn ${pl} courses · WeBWorK ${ww} courses`],
    [/^文件包含 (\d+) 门课程、(\d+) 项作业。恢复会替换当前课程和作业，并先创建本机恢复点；SendKey、Cookie、Edge 登录资料不会从文件导入。$/, (_, courses, tasks) => `File contains ${courses} courses and ${tasks} assignments. Restore replaces current data after creating a local restore point. SendKey, cookies, and Edge sign-in data are not imported.`],
    [/^已导出 (\d+) 门课程和 (\d+) 项作业；凭证和个人查询参数未写入文件。$/, (_, courses, tasks) => `Exported ${courses} courses and ${tasks} assignments. Credentials and personal URL query parameters were excluded.`],
  ];

  function locale() {
    if (language !== 'auto') return language;
    return /^zh(?:-|$)/i.test(systemLocale || '') ? 'zh-CN' : 'en-US';
  }
  function localeFor(preference, detectedLocale) {
    if (preference === 'zh-CN' || preference === 'en-US') return preference;
    return /^zh(?:-|$)/i.test(detectedLocale || Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh-CN' : 'en-US';
  }
  function translateFor(value, preference, detectedLocale) {
    const previousLanguage = language;
    const previousSystemLocale = systemLocale;
    language = preference;
    systemLocale = detectedLocale || previousSystemLocale;
    const translated = translate(value);
    language = previousLanguage;
    systemLocale = previousSystemLocale;
    return translated;
  }
  function setPreference(value, detectedLocale) {
    configured = true;
    language = ['auto', 'zh-CN', 'en-US'].includes(value) ? value : 'auto';
    if (detectedLocale) systemLocale = detectedLocale;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale();
      localize(document);
    }
  }

  function translate(value) {
    if (locale() === 'zh-CN' || typeof value !== 'string') return value;
    if (Object.hasOwn(english, value)) return english[value];
    const trimmed = value.trim();
    if (trimmed && Object.hasOwn(english, trimmed)) return value.replace(trimmed, english[trimmed]);
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(value)) return value.replace(pattern, replacement);
    }
    let result = value;
    for (const [source, target] of phrases) {
      if (source.length < 3 || !result.includes(source)) continue;
      result = result.replaceAll(source, target);
    }
    return result;
  }

  function localize(rootNode) {
    if (typeof document === 'undefined' || !rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('script,style,textarea,[data-i18n-skip]')) continue;
      const previous = originalText.get(node);
      const source = previous && previous.translated === node.nodeValue ? previous.source : node.nodeValue;
      const translated = translate(source);
      originalText.set(node, { source, translated });
      if (node.nodeValue !== translated) node.nodeValue = translated;
    }
    const elements = rootNode.querySelectorAll ? [rootNode, ...rootNode.querySelectorAll('*')] : [];
    for (const element of elements) {
      if (!element.getAttribute || element.closest('[data-i18n-skip]')) continue;
      const saved = originalAttributes.get(element) || {};
      for (const attribute of ['title', 'aria-label', 'placeholder', 'content']) {
        const current = element.getAttribute(attribute);
        if (current === null) continue;
        const source = saved[attribute]?.translated === current ? saved[attribute].source : current;
        const translated = translate(source);
        saved[attribute] = { source, translated };
        if (current !== translated) element.setAttribute(attribute, translated);
      }
      originalAttributes.set(element, saved);
    }
    document.title = translate(document.title);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!configured) setPreference('auto');
      else localize(document);
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; localize(document); });
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    });
  }

  return { locale, localeFor, setPreference, translate, translateFor, localize };
});
