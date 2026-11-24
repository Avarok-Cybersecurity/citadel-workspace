import Foundation

/// The dot the panel draws is the one the agent names, for signed-in and signed-out accounts.
func testSessionDot() {
    check(SessionDot.of(named: "yellow", connected: true) == .yellow, "a connected account the agent marks yellow is yellow")
    check(SessionDot.of(named: "yellow", connected: false) == .yellow, "a signed-out account the agent marks yellow is yellow")
    check(SessionDot.of(named: "green", connected: true) == .green, "a connected account the agent marks green is green")
    check(SessionDot.of(named: nil, connected: true) == .green, "an older agent's connected account is green, as before")
    check(SessionDot.of(named: nil, connected: false) == nil, "a signed-out account the agent does not mark has no dot")
    check(SessionDot.of(named: "purple", connected: false) == nil, "a colour this app does not know is not drawn")
    check(SessionDot.yellow.label == "Sign in needed" && SessionDot.green.label == "Connected", "each dot says what it means")

    let reply: [String: Any] = [
        "sessions": [["cid": 7, "dot": "green"], ["cid": 8, "dot": "yellow"], ["cid": 9]],
        "signed_out": [["cid": 10, "dot": "yellow"], ["cid": 11, "dot": NSNull()]],
    ]
    let named = SessionDot.named(inSessionsReply: reply)
    check(named == [7: "green", 8: "yellow", 10: "yellow"], "the reply's dots are read for sessions and for signed-out accounts")
    check(SessionDot.named(inSessionsReply: [:]).isEmpty, "a reply with no lists names no dots")
}
