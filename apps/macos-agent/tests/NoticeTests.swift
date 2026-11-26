import Foundation

/// What the agent's `NativeNotice` becomes here, and how a repeat of an app's notice is shown.
func testNotices() {
    let app: [String: Any] = [
        "cid": 7, "kind": "App", "title": "Standup", "body": "Starts at 10:00 · Team",
        "target": ["account": "alice", "server_host": NSNull(), "open": "node:workspace-root"],
        "id": "reminder:e1:1800000000000", "request_id": NSNull(),
    ]
    let notice = NoticeClient.notice(app)
    check(notice?.kind == "App" && notice?.open == "node:workspace-root", "an app notice opens the node it names")
    check(notice?.id == "reminder:e1:1800000000000", "an app notice keeps its id")
    check(notice?.osIdentifier == "7:reminder:e1:1800000000000", "its macOS identifier is the account and the id")
    check(NoticeClient.notice(app)?.osIdentifier == notice?.osIdentifier, "shown again, it replaces the one shown")

    var other = app
    other["cid"] = 8
    check(NoticeClient.notice(other)?.osIdentifier != notice?.osIdentifier, "another account's notice is its own")

    var message = app
    message["kind"] = "Message"
    message["id"] = NSNull()
    let first = NoticeClient.notice(message)
    check(first != nil && first?.id == nil, "an older agent's notice, with no id, still shows")
    check(first?.osIdentifier != first?.osIdentifier, "a notice with no id never replaces another")
}
