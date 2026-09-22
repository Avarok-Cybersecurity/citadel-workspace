import AppKit

/// Opens Citadel Workspace at one account: in the installed web app when it can be opened there,
/// otherwise on the site in the default browser.
///
/// The page reads `?account=<username>[&server=<host>]`, or the same as `web+citadel://open?...`
/// through its manifest's protocol handler, validates both, and then either switches to that
/// account's live session or shows the login form with the username filled in. Nothing secret ever
/// goes in the link, and a link never logs anyone in on its own.
enum WorkspaceLink {
    static let scheme = "web+citadel"

    static func open(_ account: Account, origin: URL, log: LogFile) {
        let query = [URLQueryItem(name: "account", value: account.username)]
            + (account.workspaceHost.map { [URLQueryItem(name: "server", value: $0)] } ?? [])

        // A Chromium app shim passes a native app's URL on only when its scheme is one the web app
        // registered; an https URL is dropped and the app opens at its start page, which would lose
        // the account. So the app is used only when it has the handler, and the browser otherwise.
        if let shim = installedApp(for: origin), handles(scheme, shim) {
            var link = URLComponents()
            link.scheme = scheme
            link.host = "open"
            link.queryItems = query
            if let url = link.url {
                NSWorkspace.shared.open([url], withApplicationAt: shim, configuration: NSWorkspace.OpenConfiguration()) { _, error in
                    if let error { log.write("the web app would not open \(account.username): \(error)") }
                }
                return
            }
        }
        var site = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        site?.queryItems = query
        if let url = site?.url { NSWorkspace.shared.open(url) }
    }

    /// The installed web app for `origin`: a Chromium-family app shim (Chrome, Edge, Brave...) in
    /// ~/Applications/<Browser> Apps.localized whose shortcut URL is on that origin.
    static func installedApp(for origin: URL) -> URL? {
        let fm = FileManager.default
        let apps = fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
        guard let folders = try? fm.contentsOfDirectory(at: apps, includingPropertiesForKeys: nil) else { return nil }
        for folder in folders where folder.lastPathComponent.hasSuffix("Apps.localized") {
            let shims = (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
            for shim in shims where shim.pathExtension == "app" {
                guard let info = Bundle(url: shim)?.infoDictionary,
                      let start = (info["CrAppModeShortcutURL"] as? String).flatMap(URL.init(string:)),
                      start.scheme == origin.scheme, start.host == origin.host else { continue }
                return shim
            }
        }
        return nil
    }

    /// Whether the app's bundle declares the URL scheme: Chromium writes the manifest's protocol
    /// handlers into the shim's CFBundleURLTypes when it (re)creates the shim.
    static func handles(_ scheme: String, _ app: URL) -> Bool {
        let types = Bundle(url: app)?.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] ?? []
        return types.contains { ($0["CFBundleURLSchemes"] as? [String] ?? []).contains(scheme) }
    }
}
