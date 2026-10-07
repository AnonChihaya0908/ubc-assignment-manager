import AppKit
import Foundation
import WebKit
import UserNotifications

private let appURL = URL(string: "http://127.0.0.1:43873/")!
private let serverURL = URL(string: "http://127.0.0.1:43873/api/state")!
private let reopenNotification = Notification.Name("com.anonchihaya.ubc-assignment-manager.reopen")

private struct ReminderEvent: Decodable {
    let key: String
    let taskId: String
    let title: String
    let message: String
}

private struct ReminderBatch: Decodable { let events: [ReminderEvent] }

private struct BrowserCommand: Decodable {
    let id: String
    let action: String
    let url: String?
    let expression: String?
    let reload: Bool?
}
private struct BrowserCommandBatch: Decodable { let command: BrowserCommand? }

@main
struct AssignmentManagerMain {
    private static let appDelegate = AssignmentManagerApp()

    static func main() {
        let application = NSApplication.shared
        if let bundleID = Bundle.main.bundleIdentifier,
           let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
             .first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            running.activate(options: [.activateAllWindows])
            DistributedNotificationCenter.default().post(name: reopenNotification, object: bundleID)
            return
        }
        application.delegate = appDelegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}

final class AssignmentManagerApp: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var courseWindow: NSWindow?
    private var courseWebView: WKWebView?
    private var browserPollTimer: Timer?
    private var browserPollBusy = false
    private var activeBrowserCommandId: String?
    private var browserCommandTimeout: DispatchWorkItem?
    private var statusItem: NSStatusItem?
    private var nodeProcess: Process?
    private let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var isQuitting = false
    private var serverReady = false
    private var reminderTimer: Timer?
    private var pendingNativeKeys = Set<String>()
    private var useEnglish: Bool {
        let value = UserDefaults.standard.string(forKey: "language") ?? Locale.preferredLanguages.first ?? "en"
        return !value.lowercased().hasPrefix("zh")
    }
    private func tr(_ chinese: String) -> String {
        if !useEnglish { return chinese }
        let labels: [String: String] = [
            "UBC作业管理工具": "UBC Assignment Manager", "显示窗口": "Show window",
            "切换菜单栏图标": "Toggle menu bar icon", "退出 UBC作业管理工具": "Quit UBC Assignment Manager",
            "立即同步": "Sync now", "退出": "Quit", "应用资源不完整。": "App resources are incomplete.",
            "缺少随包 Node.js 或应用脚本，请重新安装完整的 Mac 版本。": "Bundled Node.js or app scripts are missing. Reinstall the complete Mac app.",
            "后台服务已退出，请退出应用后重新打开。": "The background service stopped. Quit and reopen the app.",
            "本机服务未能启动。请确认端口 43873 未被其他程序占用。": "The local service could not start. Check whether another program is using port 43873.",
            "UBC作业管理工具无法启动": "UBC Assignment Manager could not start",
            "请确认操作": "Confirm action", "确认": "Confirm", "取消": "Cancel",
            "这是一条 macOS 作业提醒测试。": "This is a macOS assignment reminder test.",
            "正在启动 UBC作业管理工具…": "Starting UBC Assignment Manager…",
            "无法启动后台服务：": "Could not start the background service: ",
        ]
        return labels[chinese] ?? chinese
    }

    private var menuBarVisible: Bool {
        get { UserDefaults.standard.object(forKey: "menuBarVisible") as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: "menuBarVisible")
            configureStatusItem()
            let value = newValue ? "true" : "false"
            webView?.evaluateJavaScript("window.UBC_NATIVE_MENU_BAR_VISIBLE = \(value); const field = document.getElementById('mac-menu-bar-visible'); if (field) field.checked = \(value)")
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(handleReopen),
                                                             name: reopenNotification, object: Bundle.main.bundleIdentifier)
        UNUserNotificationCenter.current().delegate = self
        configureAppMenu()
        configureWindow()
        configureStatusItem()
        showWindow()
        startServer()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        isQuitting = true
        DistributedNotificationCenter.default().removeObserver(self)
        reminderTimer?.invalidate()
        browserPollTimer?.invalidate()
        browserCommandTimeout?.cancel()
        UNUserNotificationCenter.current().delegate = nil
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nativeHost")
        if let process = nodeProcess, process.isRunning { process.terminate() }
    }

    private func configureAppMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(actionItem(tr("显示窗口"), #selector(showWindow), key: "1"))
        appMenu.addItem(actionItem(tr("切换菜单栏图标"), #selector(toggleMenuBar)))
        appMenu.addItem(.separator())
        appMenu.addItem(actionItem(tr("退出 UBC作业管理工具"), #selector(quitApp), key: "q"))
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)
        NSApp.mainMenu = mainMenu
    }

    private func actionItem(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func configureWindow() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 810)
        let scale = min(1, (screen.width - 24) / 1440, (screen.height - 24) / 810)
        let size = NSSize(width: max(720, 1440 * scale), height: max(405, 810 * scale))
        let rect = NSRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2,
                          width: size.width, height: size.height)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = tr("UBC作业管理工具")
        window.minSize = NSSize(width: 680, height: 440)
        window.delegate = self

        let content = WKUserContentController()
        let bootstrap = """
        Object.defineProperty(window, 'UBC_NATIVE_TOKEN', {value: '\(token)', configurable: false});
        window.UBC_NATIVE_MENU_BAR_VISIBLE = \(menuBarVisible ? "true" : "false");
        """
        content.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart,
                                            forMainFrameOnly: true))
        content.add(self, name: "nativeHost")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        webView = WKWebView(frame: rect, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
        webView.loadHTMLString("<html><body style='background:#202124;color:#eee;font:14px system-ui;padding:28px'>\(tr("正在启动 UBC作业管理工具…"))</body></html>", baseURL: nil)
    }

    private func configureStatusItem() {
        if !menuBarVisible {
            if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
            statusItem = nil
            return
        }
        let item = statusItem ?? NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.title = "U"
        item.button?.toolTip = tr("UBC作业管理工具")
        let menu = NSMenu()
        menu.addItem(actionItem(tr("显示窗口"), #selector(showWindow)))
        menu.addItem(actionItem(tr("立即同步"), #selector(syncCourses)))
        menu.addItem(.separator())
        menu.addItem(actionItem(tr("退出"), #selector(quitApp)))
        item.menu = menu
        statusItem = item
    }

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func handleReopen(_ notification: Notification) { showWindow() }

    @objc private func toggleMenuBar() { menuBarVisible.toggle() }

    @objc private func quitApp() { NSApp.terminate(nil) }

    @objc private func syncCourses() {
        guard serverReady else { return }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:43873/api/sync-all/start")!)
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue(token, forHTTPHeaderField: "X-UBC-Native-Token")
        URLSession.shared.dataTask(with: request).resume()
        showWindow()
    }

    private func startServer() {
        guard let resources = Bundle.main.resourceURL else { showError(tr("应用资源不完整。")) ; return }
        let executable = resources.appendingPathComponent("runtime/node")
        let script = resources.appendingPathComponent("app.js")
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              FileManager.default.fileExists(atPath: script.path) else {
            showError(tr("缺少随包 Node.js 或应用脚本，请重新安装完整的 Mac 版本。"))
            return
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = [script.path, "--no-open", "--no-tray"]
        process.currentDirectoryURL = resources
        var environment = ProcessInfo.processInfo.environment
        environment["UBC_NATIVE_TOKEN"] = token
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.isQuitting else { return }
                self.showError(self.tr("后台服务已退出，请退出应用后重新打开。"))
            }
        }
        do {
            try process.run()
            nodeProcess = process
            waitForServer(attempt: 0)
        } catch {
            showError("\(tr("无法启动后台服务："))\(error.localizedDescription)")
        }
    }

    private func waitForServer(attempt: Int) {
        var request = URLRequest(url: serverURL)
        request.addValue(token, forHTTPHeaderField: "X-UBC-Native-Token")
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                guard let self, !self.isQuitting else { return }
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    self.serverReady = true
                    self.webView.load(URLRequest(url: appURL))
                    self.reminderTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
                        self?.pollReminders()
                    }
                    self.browserPollTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in
                        self?.pollBrowser()
                    }
                    self.pollReminders()
                    self.pollBrowser()
                } else if attempt < 100, self.nodeProcess?.isRunning == true {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.waitForServer(attempt: attempt + 1)
                    }
                } else {
                    self.showError(self.tr("本机服务未能启动。请确认端口 43873 未被其他程序占用。"))
                }
            }
        }.resume()
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = tr("UBC作业管理工具无法启动")
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    private func courseBrowser() -> WKWebView {
        if let courseWebView { return courseWebView }
        let frame = NSRect(x: 0, y: 0, width: 1080, height: 760)
        let loginWindow = NSWindow(contentRect: frame,
                                   styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                   backing: .buffered, defer: false)
        loginWindow.title = tr("课程登录")
        loginWindow.isReleasedWhenClosed = false
        loginWindow.center()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: frame, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        loginWindow.contentView = view
        courseWindow = loginWindow
        courseWebView = view
        return view
    }

    private func pollBrowser() {
        guard serverReady, !isQuitting, !browserPollBusy else { return }
        browserPollBusy = true
        var request = URLRequest(url: URL(string: "http://127.0.0.1:43873/api/native/browser/next")!)
        request.addValue(token, forHTTPHeaderField: "X-UBC-Native-Token")
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self, !self.isQuitting else { return }
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let data, let batch = try? JSONDecoder().decode(BrowserCommandBatch.self, from: data),
                      let command = batch.command else {
                    self.browserPollBusy = false
                    return
                }
                self.activeBrowserCommandId = command.id
                let timeout = DispatchWorkItem { [weak self] in
                    self?.finishBrowserCommand(command.id, error: "内置浏览器操作超时。")
                }
                self.browserCommandTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: timeout)
                self.runBrowserCommand(command)
            }
        }.resume()
    }

    private func finishBrowserCommand(_ id: String, result: Any? = nil, error: String? = nil) {
        guard activeBrowserCommandId == id else { return }
        activeBrowserCommandId = nil
        browserCommandTimeout?.cancel()
        browserCommandTimeout = nil
        var body: [String: Any] = ["id": id]
        if let result { body["result"] = result }
        if let error { body["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            browserPollBusy = false
            return
        }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:43873/api/native/browser/result")!)
        request.httpMethod = "POST"
        request.httpBody = data
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue(token, forHTTPHeaderField: "X-UBC-Native-Token")
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.browserPollBusy = false }
        }.resume()
    }

    private func runBrowserCommand(_ command: BrowserCommand) {
        if command.action == "hide" {
            courseWindow?.orderOut(nil)
            finishBrowserCommand(command.id, result: true)
            return
        }
        guard let rawURL = command.url, let url = URL(string: rawURL),
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
            finishBrowserCommand(command.id, error: "课程网址无效。")
            return
        }
        let view = courseBrowser()
        switch command.action {
        case "open":
            view.load(URLRequest(url: url))
            courseWindow?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            finishBrowserCommand(command.id, result: true)
        case "evaluate":
            guard let expression = command.expression else {
                finishBrowserCommand(command.id, error: "缺少页面读取指令。")
                return
            }
            let current = view.url
            let wrongPage = current?.host != url.host || current?.path != url.path
            if command.reload == true || wrongPage {
                view.load(URLRequest(url: url))
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                    self?.evaluateCoursePage(view, command: command, expression: expression, attempt: 0)
                }
            } else {
                evaluateCoursePage(view, command: command, expression: expression, attempt: 0)
            }
        default:
            finishBrowserCommand(command.id, error: "未知的浏览器操作。")
        }
    }

    private func evaluateCoursePage(_ view: WKWebView, command: BrowserCommand,
                                    expression: String, attempt: Int) {
        if view.isLoading && attempt < 100 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                self?.evaluateCoursePage(view, command: command, expression: expression, attempt: attempt + 1)
            }
            return
        }
        if view.isLoading {
            finishBrowserCommand(command.id, error: "课程页面加载超时。")
            return
        }
        view.callAsyncJavaScript("return await (\(expression));", arguments: [:], in: nil, in: .page) { [weak self] outcome in
            switch outcome {
            case .success(let value): self?.finishBrowserCommand(command.id, result: value)
            case .failure(let error): self?.finishBrowserCommand(command.id, error: error.localizedDescription)
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeHost", let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else { return }
        if action == "setMenuBarVisible", let visible = payload["visible"] as? Bool {
            menuBarVisible = visible
        } else if action == "setLanguage", let language = payload["language"] as? String,
                  ["zh-CN", "en-US"].contains(language) {
            UserDefaults.standard.set(language, forKey: "language")
            configureAppMenu()
            configureStatusItem()
            window.title = tr("UBC作业管理工具")
        } else if action == "showWindow" {
            showWindow()
        } else if action == "quitApp" {
            quitApp()
        } else if action == "notificationStatus" {
            refreshNotificationStatus()
        } else if action == "requestNotificationPermission" {
            requestNotificationPermission()
        } else if action == "testNotification" {
            sendTestNotification()
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView === courseWebView {
            decisionHandler(["https", "http"].contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel)
            return
        }
        if url.scheme == appURL.scheme, url.host == appURL.host, url.port == appURL.port {
            decisionHandler(.allow)
        } else {
            if ["https", "http"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                  for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if webView === courseWebView {
                webView.load(URLRequest(url: url))
                return nil
            }
            if url.scheme == appURL.scheme, url.host == appURL.host, url.port == appURL.port {
                webView.load(URLRequest(url: url))
            } else if ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = tr("请确认操作")
        alert.informativeText = message
        alert.addButton(withTitle: tr("确认"))
        alert.addButton(withTitle: tr("取消"))
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    private func refreshNotificationStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional: status = "authorized"
            case .denied: status = "denied"
            case .notDetermined: status = "notDetermined"
            default: status = "unsupported"
            }
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript("window.UBC_SET_NOTIFICATION_STATUS?.('\(status)')")
            }
        }
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.refreshNotificationStatus() }
        }
    }

    private func sendTestNotification() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                DispatchQueue.main.async { self?.refreshNotificationStatus() }
                return
            }
            let content = UNMutableNotificationContent()
            content.title = self?.tr("UBC作业管理工具") ?? "UBC Assignment Manager"
            content.body = self?.tr("这是一条 macOS 作业提醒测试。") ?? "This is a macOS assignment reminder test."
            content.sound = .default
            let request = UNNotificationRequest(identifier: "test-\(UUID().uuidString)", content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        }
    }

    private func pollReminders() {
        guard serverReady, !isQuitting else { return }
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,
                  let self else { return }
            var request = URLRequest(url: URL(string: "http://127.0.0.1:43873/api/native/reminders")!)
            request.addValue(self.token, forHTTPHeaderField: "X-UBC-Native-Token")
            URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
                guard let self, (response as? HTTPURLResponse)?.statusCode == 200,
                      let data, let batch = try? JSONDecoder().decode(ReminderBatch.self, from: data) else { return }
                DispatchQueue.main.async {
                    for event in batch.events where !self.pendingNativeKeys.contains(event.key) {
                        self.deliverReminder(event)
                    }
                }
            }.resume()
        }
    }

    private func deliverReminder(_ event: ReminderEvent) {
        pendingNativeKeys.insert(event.key)
        let content = UNMutableNotificationContent()
        content.title = event.title
        content.body = event.message
        content.sound = .default
        content.userInfo = ["taskId": event.taskId]
        let request = UNNotificationRequest(identifier: event.key, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            if error == nil { self?.acknowledgeReminder(event.key) }
            DispatchQueue.main.async { self?.pendingNativeKeys.remove(event.key) }
        }
    }

    private func acknowledgeReminder(_ key: String) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:43873/api/native/reminders/ack")!)
        request.httpMethod = "POST"
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["key": key])
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue(token, forHTTPHeaderField: "X-UBC-Native-Token")
        URLSession.shared.dataTask(with: request).resume()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.showWindow()
            if let taskId = response.notification.request.content.userInfo["taskId"] as? String,
               let encoded = try? JSONSerialization.data(withJSONObject: [taskId]),
               let json = String(data: encoded, encoding: .utf8) {
                self.webView.evaluateJavaScript("window.UBC_OPEN_TASK?.(\(json)[0])")
            }
            completionHandler()
        }
    }
}
