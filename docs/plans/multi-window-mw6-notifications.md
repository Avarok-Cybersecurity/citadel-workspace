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
