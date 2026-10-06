import AppKit
import Darwin
import Foundation
@preconcurrency import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate,
                         WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var rootURL: URL!
    private var serverProcess: Process?
    private var botProcesses: [Process] = []
    private var logHandles: [FileHandle] = []
    private var readinessTask: Task<Void, Never>?
    private var magnificationObservation: NSKeyValueObservation?
    private var pageZoomObservation: NSKeyValueObservation?
    private var botsStarted = false
    private var port = 0
    private var room = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        makeWindow()

        do {
            rootURL = try locateRuntime()
            try validateRuntime()
            port = try chooseAvailablePortSet()
            try startServer()
            waitForServer()
        }
        catch {
            showError("启动失败：\(error.localizedDescription)")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        readinessTask?.cancel()
        stopEverything()
    }

    private func installMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "退出 Mortal麻将",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        NSApplication.shared.mainMenu = mainMenu
    }

    private func makeWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "mortalTable")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsMagnification = false
        webView.magnification = 1
        webView.pageZoom = 1
        magnificationObservation = webView.observe(\.magnification, options: [.new]) {
            view, change in
            guard let value = change.newValue, abs(value - 1) > 0.0001 else { return }
            DispatchQueue.main.async {
                view.magnification = 1
            }
        }
        pageZoomObservation = webView.observe(\.pageZoom, options: [.new]) {
            view, change in
            guard let value = change.newValue, abs(value - 1) > 0.0001 else { return }
            DispatchQueue.main.async {
                view.pageZoom = 1
            }
        }
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.alphaValue = 0

        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(
            calibratedRed: 0.07,
            green: 0.20,
            blue: 0.16,
            alpha: 1
        ).cgColor
        container.addSubview(webView)

        statusLabel = NSTextField(labelWithString: "正在启动本地牌桌…")
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 22, weight: .medium)
        statusLabel.alignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            statusLabel.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -24),
        ])

        window = NSWindow(
            // Match the original "standard" desktop window exactly.  The
            // board is authored at an 800:680 aspect ratio, so 1000x850 keeps
            // the same geometry while restoring the original tile scale.
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Mortal麻将"
        window.contentAspectRatio = NSSize(width: 800, height: 680)
        window.contentMinSize = NSSize(width: 800, height: 680)
        window.contentView = container
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func locateRuntime() throws -> URL {
        let fm = FileManager.default
        let adjacent = Bundle.main.bundleURL.deletingLastPathComponent()
        let configured = Bundle.main.object(forInfoDictionaryKey: "MortalTableRoot") as? String
        let candidates = [adjacent, configured.map { URL(fileURLWithPath: $0) }]
            .compactMap { $0 }

        for candidate in candidates {
            let marker = candidate.appendingPathComponent("runtime/package.json").path
            if fm.fileExists(atPath: marker) {
                return candidate.standardizedFileURL
            }
        }
        throw AppError("找不到本地 Mortal 运行目录。请把应用放回 local-mortal-table 文件夹。")
    }

    private func chooseAvailablePortSet() throws -> Int {
        // The table server, shared bot pool, and recommendation endpoint use
        // base, base + 10,000, and base + 11,000.  Checking all three prevents
        // a stale previous process from leaving the UI playable while silently
        // disabling Mortal recommendations.
        for _ in 0..<300 {
            let candidate = Int.random(in: 47100...47999)
            if isTCPPortAvailable(candidate)
                && isTCPPortAvailable(candidate + 10_000)
                && isTCPPortAvailable(candidate + 11_000)
            {
                return candidate
            }
        }
        throw AppError("找不到可用的本地端口，请退出旧的 Mortal麻将后重试。")
    }

    private func isTCPPortAvailable(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_in>.size)
                ) == 0
            }
        }
    }

    private func validateRuntime() throws {
        let required = [
            "runtime/node_modules/@kobalab/majiang-server/bin/server.js",
            "runtime/node_modules/@kobalab/majiang-server/bin/bridge.js",
            "runtime/bin/mortal-pool-client",
            "vendor/Majiang-master/dist/netplay.html",
            "vendor/Akagi-MjaiBot-Mortal-main/bot.py",
            "vendor/Akagi-MjaiBot-Mortal-main/bot_pool.py",
            ".venv311/bin/python",
            "models/mortal-finetune-ours560-step-1100000.pth",
        ]
        for relativePath in required {
            if !FileManager.default.fileExists(
                atPath: rootURL.appendingPathComponent(relativePath).path
            ) {
                throw AppError("缺少运行文件：\(relativePath)")
            }
        }
    }

    private func nodeURL() throws -> URL {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
        if let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) {
            return URL(fileURLWithPath: path)
        }
        throw AppError("找不到 Node.js。")
    }

    private func processEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let localBin = rootURL.appendingPathComponent("runtime/bin").path
        let oldPath = environment["PATH"] ?? ""
        environment["PATH"] = [
            localBin,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            oldPath,
        ].joined(separator: ":")
        environment["MORTAL_MODEL_PATH"] = rootURL.appendingPathComponent(
            "models/mortal-finetune-ours560-step-1100000.pth"
        ).path
        return environment
    }

    private func startServer() throws {
        statusLabel.stringValue = "正在启动本地牌桌…"
        let serverScript = rootURL.appendingPathComponent(
            "runtime/node_modules/@kobalab/majiang-server/bin/server.js"
        )
        let webRoot = rootURL.appendingPathComponent("vendor/Majiang-master/dist")
        let callback = "/netplay.html?local=1&autostart=1"
        serverProcess = try launch(
            executable: try nodeURL(),
            arguments: [
                serverScript.path,
                "--port", String(port),
                "--docroot", webRoot.path,
                "--callback", callback,
                "--status",
            ],
            logName: "native-server.log"
        )
    }

    private func waitForServer() {
        let healthURL = URL(string: "http://127.0.0.1:\(port)/netplay.html")!
        readinessTask = Task { [weak self] in
            for _ in 0..<100 {
                guard let self, !Task.isCancelled else { return }
                do {
                    let (_, response) = try await URLSession.shared.data(from: healthURL)
                    if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                        loadAuthenticatedTable()
                        return
                    }
                }
                catch { }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            self?.showError("本地牌桌没有在预期时间内启动。")
        }
    }

    private func loadAuthenticatedTable() {
        statusLabel.stringValue = "正在创建房间…"
        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:\(port)/server/auth/")!
        )
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded; charset=utf-8",
            forHTTPHeaderField: "Content-Type"
        )
        let playerName = "本地玩家".addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? "Player"
        request.httpBody = "name=\(playerName)&passwd=*".data(using: .utf8)
        webView.load(request)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.magnification = 1
        webView.pageZoom = 1
        webView.alphaValue = 1
        statusLabel.isHidden = true
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showError("页面加载失败：\(error.localizedDescription)")
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "mortalTable",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String
        else { return }

        switch type {
        case "room-ready":
            handleRoomReady(body)
        case "game-ended":
            savePaipu(body)
        default:
            break
        }
    }

    private func handleRoomReady(_ body: [String: Any]) {
        guard
              let roomCode = body["room"] as? String,
              roomCode.range(of: "^[A-Z][0-9]{4}$", options: .regularExpression) != nil,
              room.isEmpty,
              !botsStarted
        else { return }

        room = roomCode
        botsStarted = true
        do {
            statusLabel.stringValue = "正在载入三个 Mortal…"
            statusLabel.isHidden = false
            try startBots()
            statusLabel.isHidden = true
        }
        catch {
            showError("Mortal 启动失败：\(error.localizedDescription)")
        }
    }

    private func savePaipu(_ body: [String: Any]) {
        guard var majiang = body["majiang"] as? [String: Any],
              var tenhou = body["tenhou"] as? [String: Any]
        else {
            showPaipuStatus("牌谱导出失败：收到的数据不完整")
            return
        }

        do {
            let localSeat = localSeatMetadata(majiang: majiang, tenhou: tenhou)
            majiang["_mortal"] = localSeat
            tenhou["_mortal"] = localSeat

            let options: JSONSerialization.WritingOptions = [
                .prettyPrinted,
                .sortedKeys,
                .withoutEscapingSlashes,
            ]
            guard JSONSerialization.isValidJSONObject(majiang),
                  JSONSerialization.isValidJSONObject(tenhou)
            else {
                throw AppError("牌谱不是有效的 JSON")
            }

            let majiangData = try JSONSerialization.data(
                withJSONObject: majiang,
                options: options
            )
            let tenhouData = try JSONSerialization.data(
                withJSONObject: tenhou,
                options: options
            )

            let directory = try paipuDirectory()
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
            let timestamp = formatter.string(from: Date())
            let roomPart = room.isEmpty ? "local" : room
            let targetPlayerPart = (localSeat["target_player_id"] as? Int)
                .map { "_ID\($0)" } ?? ""
            let basename = "\(timestamp)_\(roomPart)\(targetPlayerPart)"
            let majiangURL = directory.appendingPathComponent(
                "\(basename)_Majiang.json"
            )
            let tenhouURL = directory.appendingPathComponent(
                "\(basename)_Tenhou.json"
            )

            try majiangData.write(to: majiangURL, options: .atomic)
            try tenhouData.write(to: tenhouURL, options: .atomic)
            showPaipuStatus("两份牌谱已保存到“文稿/Mortal麻将牌谱”")
        }
        catch {
            showPaipuStatus("牌谱导出失败：\(error.localizedDescription)")
        }
    }

    private func localSeatMetadata(
        majiang: [String: Any],
        tenhou: [String: Any]
    ) -> [String: Any] {
        let localPlayerName = "本地玩家"
        let tenhouNames = tenhou["name"] as? [String]
        let majiangPlayers = majiang["player"] as? [String]
        let majiangPlayerID = majiangPlayers?.firstIndex(of: localPlayerName)
        let qijia = majiang["qijia"] as? Int

        // In tenhou.net/6 JSON, player IDs 0...3 are the East, South,
        // West, and North seats at East 1.  Prefer its already-converted
        // name order, then fall back to the equivalent Majiang mapping.
        let targetPlayerID = tenhouNames?.firstIndex(of: localPlayerName)
            ?? majiangPlayerID.flatMap { playerID in
                qijia.map { (playerID - $0 + 4) % 4 }
            }

        let winds = ["E", "S", "W", "N"]
        let seats = ["东家", "南家", "西家", "北家"]
        var metadata: [String: Any] = [
            "format_version": 1,
            "player_name": localPlayerName,
        ]

        if let targetPlayerID, winds.indices.contains(targetPlayerID) {
            metadata["target_player_id"] = targetPlayerID
            metadata["starting_seat_index"] = targetPlayerID
            metadata["starting_seat"] = seats[targetPlayerID]
            metadata["starting_seat_code"] = winds[targetPlayerID]
        }
        if let majiangPlayerID {
            metadata["majiang_player_id"] = majiangPlayerID
        }
        if let qijia {
            metadata["initial_dealer_player_id"] = qijia
        }

        return metadata
    }

    private func paipuDirectory() throws -> URL {
        guard let documents = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first else {
            throw AppError("找不到文稿文件夹")
        }
        let directory = documents.appendingPathComponent(
            "Mortal麻将牌谱",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
    }

    private func showPaipuStatus(_ text: String) {
        window.title = "Mortal麻将 — \(text)"
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard let self, self.window.title.hasPrefix("Mortal麻将 —") else {
                return
            }
            self.window.title = "Mortal麻将"
        }
    }

    private func startBots() throws {
        let bridgeScript = rootURL.appendingPathComponent(
            "runtime/node_modules/@kobalab/majiang-server/bin/bridge.js"
        )
        let poolClient = rootURL.appendingPathComponent("runtime/bin/mortal-pool-client")
        let botDirectory = rootURL.appendingPathComponent(
            "vendor/Akagi-MjaiBot-Mortal-main"
        )
        let python = rootURL.appendingPathComponent(".venv311/bin/python")
        let poolScript = botDirectory.appendingPathComponent("bot_pool.py")
        let poolPort = port + 10_000
        let serverURL = "http://127.0.0.1:\(port)/server"

        let pool = try launch(
            executable: python,
            arguments: [
                poolScript.path,
                "--port", String(poolPort),
                "--http-port", String(port + 11_000),
            ],
            logName: "native-mortal-pool.log"
        )
        botProcesses.append(pool)

        for number in 1...3 {
            let process = try launch(
                executable: try nodeURL(),
                arguments: [
                    bridgeScript.path,
                    "--room", room,
                    "--name", "Mortal-\(number)",
                    serverURL,
                    poolClient.path,
                    "--", "--pool-port", String(poolPort),
                ],
                logName: "native-mortal-\(number).log"
            )
            botProcesses.append(process)
        }
    }

    private func launch(
        executable: URL,
        arguments: [String],
        logName: String
    ) throws -> Process {
        let logs = rootURL.appendingPathComponent("logs", isDirectory: true)
        try FileManager.default.createDirectory(
            at: logs,
            withIntermediateDirectories: true
        )
        let logURL = logs.appendingPathComponent(logName)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.truncate(atOffset: 0)
        logHandles.append(handle)

        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = rootURL
        process.environment = processEnvironment()
        process.standardOutput = handle
        process.standardError = handle
        try process.run()
        return process
    }

    private func showError(_ message: String) {
        statusLabel.isHidden = false
        statusLabel.stringValue = message
        webView.alphaValue = 0
    }

    private func stopEverything() {
        for process in botProcesses.reversed() {
            terminateTree(process.processIdentifier)
        }
        if let serverProcess {
            terminateTree(serverProcess.processIdentifier)
        }
        botProcesses.removeAll()
        serverProcess = nil
        for handle in logHandles {
            try? handle.close()
        }
        logHandles.removeAll()
    }

    private func terminateTree(_ pid: pid_t) {
        guard pid > 1 else { return }
        for child in childPIDs(of: pid) {
            terminateTree(child)
        }
        Darwin.kill(pid, SIGTERM)
    }

    private func childPIDs(of pid: pid_t) -> [pid_t] {
        let task = Process()
        let pipe = Pipe()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        task.arguments = ["-P", String(pid)]
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
        }
        catch {
            return []
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let text = String(data: data, encoding: .utf8) ?? ""
        return text.split(whereSeparator: \.isNewline).compactMap { pid_t($0) }
    }

}

struct AppError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
