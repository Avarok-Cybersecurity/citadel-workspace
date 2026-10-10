import Foundation
import UserNotifications

/// Raises the agent's notices as macOS notifications, under this app's bundle identity, and opens
/// the workspace at the notice's target when one is clicked.
///
/// The text is exactly what the agent sent: the account's preview setting was applied there, so a
/// lock screen shows the sender unless the user turned previews on.
final class NoticePoster: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private let log: LogFile
    var onOpen: ((_ account: String, _ server: String?, _ open: String) -> Void)?
    var onOpenURL: ((URL) -> Void)?
    private var announced: String?
    /// Told whether macOS lets this app show notifications; not told while the user has yet to answer.
    var onAuthorization: ((_ allowed: Bool) -> Void)?

    /// System Settings at this app's notification switch (macOS 13+ pane id).
    static var settingsURL: URL {
        let id = Bundle.main.bundleIdentifier ?? ""
        return URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)")!
    }

    init(log: LogFile) {
        self.log = log
        super.init()
    }

    /// Once at launch. macOS asks the user the first time and remembers the answer.
    func prepare() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [log, weak self] granted, error in
            if let error { log.write("notifications could not be requested: \(error)") }
            if !granted { log.write("notifications are turned off for Citadel Agent") }
            self?.checkAuthorization()
        }
    }

    /// The answer as it stands now: the user may have changed it in System Settings since launch.
    func checkAuthorization() {
        center.getNotificationSettings { [weak self] settings in
            guard settings.authorizationStatus != .notDetermined else { return }
            let allowed = settings.authorizationStatus != .denied
            DispatchQueue.main.async { self?.onAuthorization?(allowed) }
        }
    }

    func post(_ notice: Notice) {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.subtitle = notice.account
        content.body = notice.body
        content.sound = .default
        // One thread per account, so several accounts' notices do not interleave.
        content.threadIdentifier = String(notice.cid)
        content.userInfo = ["account": notice.account, "server": notice.serverHost ?? "", "open": notice.open]
        if notice.kind == "IncomingCall" { content.interruptionLevel = .timeSensitive }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request) { [log] error in
            if let error { log.write("a notification could not be shown: \(error)") }
        }
    }

    /// "Citadel Agent X.Y.Z is available", once per version; a click opens the release.
    func post(_ update: AgentUpdate) {
        guard update.latest != announced else { return }
        announced = update.latest
        let content = UNMutableNotificationContent()
        content.title = "Citadel Agent \(update.latest) is available"
        content.body = update.ready
            ? "Choose Restart to update in the menu bar. Signed-in accounts will need to sign in again."
            : "Download it to update from \(update.current)."
        content.userInfo = ["url": (update.ready ? update.notesURL : update.downloadURL).absoluteString]
        center.add(UNNotificationRequest(identifier: "update-\(update.latest)", content: content, trigger: nil)) { [log] error in
            if let error { log.write("the update notification could not be shown: \(error)") }
        }
    }

    /// A menu-bar app is never the frontmost window, but say so anyway: show it, with its sound.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let url = (info["url"] as? String).flatMap(URL.init(string:)) {
            DispatchQueue.main.async { self.onOpenURL?(url) }
        }
        if let account = info["account"] as? String, let open = info["open"] as? String {
            let server = (info["server"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            DispatchQueue.main.async { self.onOpen?(account, server, open) }
        }
        done()
    }
}
