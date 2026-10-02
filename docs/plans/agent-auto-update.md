# Agent auto-update

Owner request: the Citadel agent updates itself from GitHub releases, and users are told when a new
version is out. Branch `feat/agent-auto-update` in the parent and the UI, same name in the agent.
Version 0.8.8; it follows 0.8.7 (the SDK group-join fix, `chore/agent-0.8.7`), which must merge
first or be rebased under this.

## Where each piece lives

| Piece | Repo | Path |
|---|---|---|
| Updater core: check, pick, download, verify, stage, decide, self-swap, watchdog | agent | `citadel-internal-service/src/updater/` |
| Wire types (`UpdateAvailable`, `UpdateStatus`, `UpdateInstall`, requests) | agent | `citadel-internal-service-types/src/updates.rs` |
| Request handlers and the broadcast notifier | agent | `citadel-internal-service/src/kernel/updates.rs`, `kernel/requests/update.rs` |
| Wiring: version, cache dir, bind address, watchdog entry | parent | `citadel-workspace-internal-service/src/update_setup.rs` |
| macOS swap, relaunch, rollback; panel row | parent | `apps/macos-agent/Updater*.swift`, `BundleSwap.swift` |
| Banner and settings | UI | `src/components/agent-update/*` |

## Check

On start and every 6 h, `GET https://api.github.com/repos/Avarok-Cybersecurity/citadel-workspace/releases/latest`
with `If-None-Match`. Repo and URL are constants. A draft, a prerelease, a tag that is not
`agent-vMAJOR.MINOR.PATCH`, or a version not above the running one is "no update". Semver comes from
the tag; the running version is `CARGO_PKG_VERSION` of `citadel-workspace-internal-service`, the
crate whose `--version` the release gates already compare with the tag.

## Install type and asset (detected from facts, decided purely)

| Running as | Asset | Applies? |
|---|---|---|
| `…/X.app/Contents/MacOS/citadel-agent` started by the menu-bar app (launch token present) | `Citadel-Agent.dmg` | yes, by the Swift app |
| macOS or Linux binary in a user-writable directory (tarball) | `citadel-agent-{macos-arm64,macos-x64,linux-x64}.tar.gz` | yes, by the agent |
| Linux, `$APPIMAGE` set and writable | `Citadel-Agent-x86_64.AppImage` | yes, by the agent |
| Linux, executable listed in `/var/lib/dpkg/info/citadel-agent.list` | `citadel-agent-linux-x64.deb` | no: link only (installing a package needs root; the agent never escalates) |
| Windows | `Citadel-Agent-x64.msi` | no: link only (the MSI is per-machine, so it needs UAC; not tested here) |
| anything else, or an unwritable directory | — | no: link to the release page |

The .dmg, not the tarball, for the app: the bundle is signed and notarised as a whole, so replacing
the binary inside it would break the seal and leave the launcher old. The .dmg carries the whole
signed, notarised, stapled app, which the Swift app can verify as a unit before it swaps.

## Verify (any failure leaves the install untouched and logs why at `error`)

1. HTTPS only, every hop (redirects included) to `api.github.com`, `github.com`,
   `objects.githubusercontent.com` or `release-assets.githubusercontent.com` — the last is where
   GitHub redirects release downloads today, so it has to be on the list. Asset URLs must be
   `https://github.com/Avarok-Cybersecurity/citadel-workspace/releases/download/<tag>/<name>`.
2. sha256 of the download equals the release's `<name>.sha256` (both the `  name` and ` *name` forms;
   the name must match).
3. GitHub artifact attestation (Sigstore bundle from `/attestations/sha256:<digest>`, verified with
   `sigstore-verify` against the embedded production trust root): issuer
   `token.actions.githubusercontent.com`, SAN `…/citadel-workspace/.github/workflows/release-agent.yml@`
   `refs/heads/master` or `refs/tags/<this tag>`. Every asset is attested today. If none exists the
   agent does not apply automatically on Linux (no other signature) and offers the download link;
   on macOS the code signature below is the alternative.
4. macOS app (Swift): `SecStaticCodeCheckValidity` (strict, all architectures, nested code) against
   `identifier "net.avarok.citadel-agent" and anchor apple generic and certificate leaf[subject.OU] = <running app's team>`,
   `spctl --assess --type execute` (notarised Developer ID), and `CFBundleShortVersionString` equal to the tag.
5. Never a downgrade or the same version.
6. `--version` of the staged binary (tarball, AppImage, the app's embedded agent) must print
   `citadel-agent X.Y.Z` for the tag.

## Notify

`UpdateAvailable { current, latest, notes_url, download_url, ready }` goes to every connected window
(the UI banner: "Citadel Agent X.Y.Z is available" with "Restart to update" when ready, "Download"
otherwise) and to the menu-bar app's notice stream (a native notification and a panel row).

## Apply

Download and verify in the background. Apply only when the user presses "Restart to update" (UI or
menu bar), or automatically when no account is signed in and the setting is on. The UI states that
open accounts will have to sign in again before it sends the request.

- macOS app: the agent sends `UpdateInstall { version, path }` on the notice stream. The Swift app
  mounts the image read-only, copies the app beside the installed one, verifies it, stops the agent,
  swaps the two bundles atomically (`renamex_np(RENAME_SWAP)`), opens the new app and waits for the
  agent's loopback socket. No answer in time: it terminates the new app, swaps back and restarts its
  own agent. It reports the outcome back with `UpdateInstallResult`.
- Linux / macOS tarball and AppImage: the agent stages the new file beside the old one (same
  filesystem), keeps a hard-link backup, renames the new one over it (atomic), and starts a
  watchdog — the OLD binary, in a mode selected by an environment variable — then exits. The
  watchdog starts the new version and waits for its loopback socket; if it does not answer, it
  restores the backup by rename and starts it again, and records the failed version so it is not
  retried automatically.

A version whose install failed is never retried automatically in that run or the next.

## Settings

"Automatically install updates when no account is signed in" (default on, as the owner asked) and
"Check now", stored in the agent's key-value store (`agent_update_auto_install`).

## Security notes

- Requests that apply or configure updates come from any allowed-origin window, the same trust the
  UI already has. The worst they can do is install a verified newer release now, which signs
  everyone out; the UI asks first.
- `UpdateInstall` goes only to the token-holding menu-bar app; `UpdateInstallResult` must carry
  the token.
- The trust root is embedded: if Sigstore rotates its keys before the agent is updated, attestation
  checks fail closed and updates stop being applied (the banner still links the download).

## SBIO seams

`ReleaseSource` (GitHub HTTP), `Provenance` (attestation), `Stager` (filesystem staging, `--version`),
`Installer` (swap and relaunch), `UpdateNotifier` (windows, menu-bar app), `UpdateSettings` (store).
Pure and unit-tested: tag/semver, release selection, asset choice, install-type decision, sha file
parsing, the verification verdict, the apply-now decision, the attestation identity check.

## Tests

Unit tests for every pure function; an integration test drives the engine through a fake
`ReleaseSource` serving a fixture `latest` and fixture assets: happy path, sha mismatch, downgrade,
missing asset, network error, 304. The attestation check runs against a real recorded bundle by
digest. Swift: the swap and rollback against scratch bundles, never `/Applications`. Negative
controls on the sha check, the downgrade guard, the identity check and the rollback.

## Shipping

The updater is compiled in by the parent crate's `self-update` feature, which only the release
builds enable (`.github/actions/build-agent`). Neither the docker image nor a developer's
`cargo run` can replace itself. A release's macOS app job also runs
`scripts/test-macos-agent-updater.sh` against the freshly notarised app. Any build that the
installed app's updater would refuse therefore fails the release.

## Left open

- The real relaunch (opening the new app and waiting on its socket) is tested only with
  scripted steps. Launching a second copy of the app here would compete with the owner's
  running agent for port 12345. The verification and the bundle swap were run for real, on a
  scratch copy of the installed 0.8.6 app.
- Windows (MSI) and dpkg installs only show a link. Installing either needs elevation.
- The Sigstore trust root is embedded, so a key rotation stops automatic installs until the
  agent is updated by hand.
- `check-feature-gated-tests-are-compiled` does not follow a `#[cfg(feature)]` on a `mod`
  declaration into the module's file. The `self-update` test step in validate.yml is
  therefore needed, and the gate cannot detect it going missing.
