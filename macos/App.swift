import AppKit
import Foundation
import WebKit

private let appURL = URL(string: "http://127.0.0.1:43873/")!
private let serverURL = URL(string: "http://127.0.0.1:43873/api/state")!
private let reopenNotification = Notification.Name("com.anonchihaya.ubc-assignment-manager.reopen")

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
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem?
    private var nodeProcess: Process?
    private let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var isQuitting = false
    private var serverReady = false

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
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "nativeHost")
        if let process = nodeProcess, process.isRunning { process.terminate() }
    }

    private func configureAppMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(actionItem("显示窗口", #selector(showWindow), key: "1"))
        appMenu.addItem(actionItem("切换菜单栏图标", #selector(toggleMenuBar)))
        appMenu.addItem(.separator())
        appMenu.addItem(actionItem("退出 UBC作业管理工具", #selector(quitApp), key: "q"))
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
        window.title = "UBC作业管理工具"
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
        webView.loadHTMLString("<html><body style='background:#202124;color:#eee;font:14px system-ui;padding:28px'>正在启动 UBC作业管理工具…</body></html>", baseURL: nil)
    }

    private func configureStatusItem() {
        if !menuBarVisible {
            if let item = statusItem { NSStatusBar.system.removeStatusItem(item) }
            statusItem = nil
            return
        }
        if statusItem != nil { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.title = "U"
        item.button?.toolTip = "UBC作业管理工具"
        let menu = NSMenu()
        menu.addItem(actionItem("显示窗口", #selector(showWindow)))
        menu.addItem(actionItem("立即同步", #selector(syncCourses)))
        menu.addItem(.separator())
        menu.addItem(actionItem("退出", #selector(quitApp)))
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
        guard let resources = Bundle.main.resourceURL else { showError("应用资源不完整。") ; return }
        let executable = resources.appendingPathComponent("runtime/node")
        let script = resources.appendingPathComponent("app.js")
        guard FileManager.default.isExecutableFile(atPath: executable.path),
              FileManager.default.fileExists(atPath: script.path) else {
            showError("缺少随包 Node.js 或应用脚本，请重新安装完整的 Mac 版本。")
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
                self.showError("后台服务已退出，请退出应用后重新打开。")
            }
        }
        do {
            try process.run()
            nodeProcess = process
            waitForServer(attempt: 0)
        } catch {
            showError("无法启动后台服务：\(error.localizedDescription)")
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
                } else if attempt < 100, self.nodeProcess?.isRunning == true {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.waitForServer(attempt: attempt + 1)
                    }
                } else {
                    self.showError("本机服务未能启动。请确认端口 43873 未被其他程序占用。")
                }
            }
        }.resume()
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "UBC作业管理工具无法启动"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativeHost", let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else { return }
        if action == "setMenuBarVisible", let visible = payload["visible"] as? Bool {
            menuBarVisible = visible
        } else if action == "showWindow" {
            showWindow()
        } else if action == "quitApp" {
            quitApp()
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
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
        alert.messageText = "请确认操作"
        alert.informativeText = message
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}
