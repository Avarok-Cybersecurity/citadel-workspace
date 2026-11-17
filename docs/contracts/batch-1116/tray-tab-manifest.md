# Contract: tray tab manifest and update manifest (plan §5.4; D-C) — FROZEN 2026-11-16

Schemas: `tray-tab-manifest.schema.json`, `update-manifest.schema.json`; fixtures under
`fixtures/tray-tab-manifest/`, `fixtures/update-manifest/`; signing vectors `tray-tab-kat.json`
(a TEST publisher key). Reference implementation: `avarok-desktop/crates/tray-core` (T1), whose
choices this file adopts. Consumers: TrayKit/Avarok host (T2), the three tabs (T3).

## 1. Location and discovery

Per user: macOS `~/Library/Application Support/Avarok/tabs/<id>.json`; Windows
`%LOCALAPPDATA%\Avarok\tabs\<id>.json`; Linux `$XDG_DATA_HOME/avarok/tabs/<id>.json`. The file
name must be `<id>.json` (`FileNameMismatch` otherwise). The host watches the directory (behind
one port) and re-verifies **every** manifest on every change; at most 64 files are considered and a
file over 64 KiB is refused unread.

## 2. Signing (both manifests)

`sig` = base64url (no pad) of a FIPS 204 **ML-DSA-65** signature, deterministic, with the
**context string** `avarok-tab-manifest-v1` (tab) or `avarok-update-manifest-v1` (update), over
the RFC 8949 deterministic CBOR of the JSON document without `sig`: text keys sorted by their
encoded bytes, shortest unsigned integers, text strings, booleans, arrays; absent optional fields
are absent (a `null` is refused by the schema). This differs from the identity crate's
`domain ‖ 0x00 ‖ body` convention on purpose: tray-core shipped with contexts and the two never
share a key. `publisher.mldsa65_public_key` is 3904 lowercase hex characters; the host accepts
only keys in its pinned list (Avarok's today, D-C) **and** `publisher.name` must equal the pinned
name (`PublisherNameMismatch`). The pinned list is empty in the open-source crate and filled by
the host build; an empty list refuses everything (`NoPinnedPublishers`), never trusts everything.

## 3. Tab manifest rules the schema cannot state (host enforces, each a refusal)

- `id`: reverse-DNS, ≥ 2 labels of `[a-z0-9-]` not edged by `-`, ≤ 128 bytes; safe as a file name.
- `app`: at least one complete platform (`macos_bundle_id` + `macos_team_id` (10 chars);
  `windows_exe` + `windows_publisher_thumbprint` (sha256 hex); `linux_exec`). macOS: the bundle
  found for the id must satisfy `anchor apple generic and certificate leaf[subject.OU] =
  <macos_team_id>`. Windows: `windows_exe` under `%ProgramFiles%\`, `%ProgramFiles(x86)%\` or
  `%LOCALAPPDATA%\Programs\`, no `.`/`..` segment, and `WinVerifyTrust` with the pinned
  thumbprint. Linux: `linux_exec` under `/usr/`, `/opt/` or `~/.local/`, no `.`/`..` segment, not
  writable by others; §2 is the only signature gate.
- `agent`: `argv` ≤ 32 entries of ≤ 1024 bytes without NUL; `ready.port` ≥ 1024; `crash_cap`
  1..=10 (restart cap before `failed`; a user restart resets it; back-off 1-2-4-8-16 s).
- `panel.web.url` is `http://127.0.0.1:<agent.ready.port>/<path>` with the **same port** as
  `ready`; `token` is `stdout-handshake` (the host reads the token from the stdout of the process
  it launched and loads the panel from that port only). `panel.native.macos_module` is a Swift
  module name ≤ 64.
- `actions` ≤ 16, ids unique `[a-z0-9-]{1,64}`, titles 1..=64 printable chars, `url_fragment`
  starts with `#`, ≤ 256 printable ASCII.
- `icon_template_png`: standard base64 of a PNG (magic `89 50 4E 47 0D 0A 1A 0A`) ≤ 16 KiB; a
  template image (monochrome with alpha) for the menu bar.

## 4. Update manifest (`{format, product, version, notes_url, assets[], publisher, sig}`)

Verified with the update context by a pinned publisher **before** parsing. `format == 1`;
`product` must equal the host's own product id; `version` is `x.y.z` (each part ≤ 9 digits, no
prefix) and only a **strictly newer** version is `Available`; `notes_url` and every asset `url`
are `https://`; the asset for the host's `target` (e.g. `macos-aarch64`) must exist; the download
must match `size` and `sha3_256`; the staged bundle must pass the OS code-signature check for
`app` before it replaces anything.

## 5. Tests (plan §4 T1 row)

Verifier refuses unsigned, foreign-publisher, name-mismatch, path-escaping, oversize, below-port,
non-loopback-panel manifests (control each: the `invalid-*` fixtures here are the table);
supervision table; `cargo deny` bans AGPL/GPL (control: add an AGPL crate → red).
