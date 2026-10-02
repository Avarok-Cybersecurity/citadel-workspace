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

    init(log: LogFile) {
        self.log = log
        super.init()
    }

    /// Once at launch. macOS asks the user the first time and remembers the answer.
    func prepare() {
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [log] granted, error in
            if let error { log.write("notifications could not be requested: \(error)") }
            if !granted { log.write("notifications are turned off for Citadel Agent") }
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

    /// A menu-bar app is never the frontmost window, but say so anyway: show it, with its sound.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let account = info["account"] as? String, let open = info["open"] as? String {
            let server = (info["server"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            DispatchQueue.main.async { self.onOpen?(account, server, open) }
        }
        done()
    }
}
