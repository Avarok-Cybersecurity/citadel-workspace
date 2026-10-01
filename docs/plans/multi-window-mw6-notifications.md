# Multi-window mw6: native notifications from the agent

The last phase of [multi-window-sessions.md](multi-window-sessions.md), after the switch-over (mw5).

- **Per signed-in account,** the agent raises OS notifications for what the web UI notifies for today:
  direct and group messages, and peer requests. It adds what the web UI only shows in-page: incoming
  calls, file offers and group invites.
- **Suppression.** A notification is suppressed when an attached window reports, via `ReportFocus { cid,
  peer_cid }`, that this account and conversation are focused.
- **Preview.** A new `notificationPreview: 'sender' | 'text'` preference sets what a notification shows.
  Calls always alert.
- **Deep links.** A click opens the account's workspace at the target. The PWA's `web+citadel` handler is
  used if it is installed, otherwise the browser.
  - The URL is `https://<origin>/?account=<username>&server=<server_host>&open=<target>`.
  - `open=conversation:<peerCid>`, `call:<peerCid>` or `requests`.
  - That is a small extension of `account-link.ts`. `server_host` is already per session in the agent
    (`Connection.server_host`).
- **Tray rows.** One row per signed-in account, with its unread count (from mw4's metadata), mute, and a
  settings link.
- **Structure (SBIO).**
  - The decision logic is pure and unit-tested: what to notify, when to suppress, which deep link.
  - The OS side sits behind a `Notifier` + `Tray` trait, with macOS, Linux and Windows implementations
    and a test double.
  - **macOS:** the existing Swift menu-bar app holds the bundle identity that notifications need. It
    subscribes to an agent event stream and raises `UNUserNotification`s. Its panel gains the unread,
    mute and settings rows.
  - **Linux and Windows:** have no tray today. The agent gains one (`tray-icon`) and native
    notifications (D-Bus and WinRT toast).

## As built (agent 0.8.6, macOS)

- **Decision** (agent `kernel/notices/decide.rs`, pure).
  - What raises a notice: a chat message from a peer, a ring (`CallInvite`), a peer request, a group
    invitation, a file offer.
  - A muted account raises nothing but calls.
  - A window showing that conversation holds back its messages and files. A window showing that
    account holds back the rest.
  - `NotificationPreview::SenderOnly` is the default, per account, so a notice names the sender until
    the user turns on "Message Text in Notifications" (Settings → Privacy). A call has no text.
  - The target holds the account, its server host and the target id only. The menu-bar app builds the
    URL from its own origin, and a test asserts that no content reaches it.
- **Focus** is `ConnectionManagement::ReportFocus { session_cid, peer_cid, focused }`.
  - Only a window attached to the session may send it. The web UI sends it when the answer changes.
  - It is read when the event happens, not when the notice is sent. A closed window's focus is dropped
    with it.
- **The notice plane** is `NoticeSubscribe` / `NoticeSetMuted`, answered with `NoticeRows` and followed
  by `NativeNotice`.
  - One subscriber hears every account, so it is gated by a launch token. Citadel Agent.app mints the
    token for each launch (32 random bytes) and passes it only in the agent's environment
    (`CITADEL_NOTICE_TOKEN`), never as an argument.
  - The token is compared in constant time and never logged. The agent's Debug of it is redacted.
  - A terminal-run agent has no token, and its plane stays shut.
- **macOS** (`apps/macos-agent`): `NoticeClient` subscribes, and `NoticePoster` raises
  `UNUserNotification`s (calls are time-sensitive) and opens the link on a click. The panel's connected
  rows show the unread count, a mute bell and a settings button (`open=settings:notifications`).
- **Linux and Windows** follow in 0.8.7, as a `Notifier` registered on the hub (`NoticeHub::new`'s
  `others`), proven on those CI legs.
