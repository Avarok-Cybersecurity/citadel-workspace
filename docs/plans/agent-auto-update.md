# Agent auto-update

Owner request: the Citadel agent updates itself from GitHub releases, and users are told when a new
version is out. Branch `feat/agent-auto-update` in the agent and the UI; in the parent,
`feat/agent-auto-update-0.8.7`, onto `chore/agent-0.8.7`. It ships in 0.8.7 with the rest of that
release (the owner wants as few releases as possible), not as a release of its own.

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

Every check below is required; the ML-DSA signature is checked first and replaces none of the
others.

0. ML-DSA-65 (FIPS 204) release signature. The release must publish `<name>.mldsa.sig` beside the
   asset; without one the update is refused before anything is downloaded. After the download
   the agent rebuilds the signed message from the release's tag, the asset's name and the sha256
   it computed itself, and verifies it against the public key it embeds
   (`citadel-internal-service/citadel-internal-service/src/updater/release_key.rs`, the text of
   `release_public_key.txt`).
   Missing, malformed, by another key, or for another tag, file or digest: refused, and
   `UpdateStatus.last_error` says why, prefixed `ML-DSA:`. `UpdateAvailable.mldsa_verified` is true
   when the staged update passed it (the UI's badge). The format, defined once in the agent's
   `citadel-release-signature` crate and used by both the updater and `tools/release-sign`:

   ```text
   message   = b"citadel-agent-release-v1\0" || tag || b"\0" || asset_name || b"\0" || sha256(asset)
   signature = ML-DSA-65, deterministic, empty context, over message
   .mldsa.sig = hex(signature) (3309 bytes, 6618 lowercase hex characters) and a newline
   ```

   `tag` is `agent-vX.Y.Z` and `asset_name` the published file name (`Citadel-Agent.dmg`), both
   UTF-8 without NUL; `sha256(asset)` is the 32 raw bytes of the digest. Binding the tag and the
   name means a signature cannot be moved onto another asset or another release. The public key is
   the 1952-byte ML-DSA-65 verifying key in hex (3904 characters); the private key is the 32-byte
   seed in hex, the `CITADEL_RELEASE_MLDSA_KEY` repository secret.
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

`UpdateAvailable { current, latest, notes_url, download_url, ready, mldsa_verified }` goes to every connected window
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

## Signing releases

`release-agent.yml` signs every asset (everything in `dist/` but the `.sha256` files) in its
`sign` job with `tools/release-sign`, after the builds and before publishing, and verifies each
signature with the same tool against the agent's embedded public key before anything is uploaded.
`gh release create` publishes the `.mldsa.sig` files with the assets, and the publish step refuses
any asset without one.

- The `release-key` job runs before any build. On a run that publishes, it fails if
  `CITADEL_RELEASE_MLDSA_KEY` is unset, if the embedded key is the placeholder
  (`citadel_release_signature::PLACEHOLDER_PUBLIC_KEY`), or if the secret is not the embedded
  key's private half (it signs a probe and verifies it). No release is published unsigned.
- A `workflow_dispatch` dry run signs with a key generated in the job and thrown away, under the
  tag `dry-run-agent-vX.Y.Z`. It is labelled as such in the log, and nothing it signs is published.
- Validate's `release-sign` job tests the tool and fails a PR whose agent embeds no real key.

Key setup (once, by the owner; the private key never enters a repository or a log):

```sh
git submodule update --init citadel-internal-service
cargo run --release --manifest-path tools/release-sign/Cargo.toml -- keygen \
  --private-key ~/citadel-release-mldsa.key \
  --public-key citadel-internal-service/citadel-internal-service/src/updater/release_public_key.txt
gh secret set CITADEL_RELEASE_MLDSA_KEY -R Avarok-Cybersecurity/citadel-workspace < ~/citadel-release-mldsa.key
```

`keygen` creates the private key file with mode 0600 and never overwrites one. It prints only the
public key, which is safe to print, and `--public-key` writes it where the agent embeds it. That
change is committed in the agent repository. Rotating the key works the same way, and an agent
only trusts the new key once it has been updated to a build that embeds it.

### Bootstrap

Releases before the first ML-DSA-capable agent publish no `.mldsa.sig`, and agents before that one
never look for it. The first ML-DSA-capable agent therefore arrives by the classical path: an
older agent installs it on its sha256 and attestation (and, for the app, its code signature and
notarisation) as before. From that agent on, a release without a valid signature by the embedded
key is refused, so no later update can be installed by the classical checks alone.

## Settings

"Automatically install updates when no account is signed in" (default on, as the owner asked) and
"Check now", stored in the agent's key-value store (`agent_update_auto_install`).

## Security notes

- Requests that apply or configure updates come from any allowed-origin window, the same trust the
  UI already has. The worst they can do is install a verified newer release now, which signs
  everyone out; the UI asks first.
- `UpdateInstall` goes only to the token-holding menu-bar app; `UpdateInstallResult` must carry
  the token.
- The ML-DSA public key is embedded, like the trust root. An update signed by any other key,
  including a new key the agent was never told about, is refused.
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
