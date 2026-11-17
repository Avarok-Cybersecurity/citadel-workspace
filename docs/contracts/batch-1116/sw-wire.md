# Contract: synchronized.work wire (`sw-protocol`, SW rev 3 §4; plan §5.5) — FROZEN 2026-11-16

Fixtures: `fixtures/sw-wire/*.json` (`cbor_hex` + `model`), keys and intermediate values in
`sw-wire-kat.json`. `node scripts/check-batch-contracts.mjs` decodes every `cbor_hex`, compares it
with `model`, and re-encodes the model canonically: the bytes must be identical. The four parties
(node, site, mcp, app) must decode every fixture to the same values (S1's conformance gate);
`synchronized.work/fixtures/` mirrors this directory byte for byte.

## 1. Encoding

RFC 8949 **core deterministic** CBOR: shortest integer heads, definite lengths only, map keys
sorted by the bytes of their encoding, no duplicate keys, **no floats**, no tags, no indefinite
items. A decoder refuses anything else (`deny_unknown_fields` for maps: an unlisted key is an
error, a missing required key is an error). Integer-keyed maps where stated; payload maps use text
keys. Hashes everywhere in this wire are **SHA3-256** (coordinator decision 2026-11-16: one hash
family across the batch; SW rev 3's SHA-256 is superseded).

Fixture `model` notation: `{"$map": [[k, v], …]}` in canonical order, `{"$hex": "…"}` for byte
strings, `{"$u64": "decimal"}` for integers ≥ 2^53, plain numbers, strings, booleans, arrays.

## 2. Envelopes (integer keys)

```
SwMessage = { 1: typ (uint 1..=17),  2: unsigned (map)  |  3: signed (Signed) }   -- exactly one of 2/3
Signed    = { 1: alg "ML-DSA-65", 2: kid bstr(32), 3: body bstr, 4: sig bstr(3309) }
Body      = { 1: typ, 2: iss tstr(16) = id_fp, 3: from uint64 = sender CID, 4: aud tstr "synchronized.work" | uint64 CID,
              5: iat uint64 ms, 6: exp uint64 ms, 7: nonce bstr(16), 8: seq uint64, 9: payload map }
Sealed    = { 1: kem "ML-KEM-768", 2: rcpt bstr(32), 3: ct bstr(1088), 4: aead "AES-256-GCM", 5: n bstr(12), 6: enc bstr }
P2P env.  = { "type": "sw/1", "payload": bstr = SwMessage bytes }                   -- text keys, exactly two
```
- `kid = SHA3-256(encoded verifying key)` (ML-DSA-65 pk, 1952 B; ML-KEM-768 ek, 1184 B).
  `iss` is the Person's `id_fp` (identity-api §4); the Person's root `kid` is `SHA3-256(identity pk)`.
- `sig = ML-DSA-65.Sign(sk, "sw-signed-v1" ‖ 0x00 ‖ body_bytes)`, pure, empty context,
  deterministic. `body_bytes` is the exact byte string in `Signed[3]`; verifiers sign-check those
  bytes and only then decode them. `Body[1].typ == SwMessage[1].typ` or the message is refused.
- `signal_id = SHA3-256(Signed bytes)` (the canonical encoding of the `Signed` map).
- Checks on receipt (node and Device alike): key `kid` known for `iss` (Person record, or the
  identity key for `typ 11`); `from == session CID`; `aud` is the receiver (`"synchronized.work"`
  at the node; the Device's own CID inside a sealed payload); `iat ≤ now + 60 s`; `exp > now`
  (`exp - iat ≤ 24 h` for 2/3/4/5/6/17, ≤ 5 min otherwise); `(kid, nonce)` unseen until `exp`;
  `seq` strictly greater than the last seen for `kid`.
- Sealing (`typ 4, 5` only): `Body[9]` **is** the `Sealed` map. `ct, ss = ML-KEM-768.Encaps(ek)`;
  `key = HKDF-SHA3-256(salt = none, ikm = ss, info = "sw/seal/1", L = 32)`;
  `enc = AES-256-GCM(key, n, aad = ∅, plaintext = canonical CBOR of the inner map)`; the inner map
  carries `aud` (the Device CID) plus the type's payload fields. `rcpt = SHA3-256(ek)`.
- Signature and seal keys are per Endpoint and never derived from the identity seed.

## 3. Message types and payloads (text keys; every listed key required unless `?`)

| typ | name | route / signer | slot | payload |
|---|---|---|---|---|
| 1 | HELLO | Endpoint→node, unsigned | 2 | `protocol_version: 1`, `endpoint_kind: "device"\|"controller"\|"viewer"`, `client_build: tstr` |
| 2 | STATUS_UPDATE | Device key | 3 | `agent_id, task_id: tstr`, `lane: Lane`, `blockers: [Blocker] ≤ 16`, `harness: tstr` |
| 3 | PROGRESS_EVENT | Device key | 3 | `agent_id`, `events: [{at: uint ms, kind: tstr, body: tstr ≤ 512 B}] ≤ 64` |
| 4 | PROMPT | Controller key, **Sealed** | 3 | inner: `aud: uint CID, task_id, text, mode: "queue"\|"interrupt", agent_id?, reply_to?: bstr(32) = signal_id` |
| 5 | CONTROL | Controller key, **Sealed** | 3 | inner: `aud`, `op: "pause"\|"resume"\|"stop"\|"set_tier"\|"approve_join"\|"refuse_join"`, `tier?: Tier` (iff `set_tier`), `id?: bstr(32)` (the JOIN_REQUEST's `signal_id`; iff `approve_join`/`refuse_join`), `reason?: tstr ≤ 280 B` (iff `refuse_join`) |
| 6 | ACK | Device key | 3 | `signal_id: bstr(32)`, `result: "delivered"\|"executed"\|"refused"\|"expired"`, `reason?` (iff `refused`) |
| 7 | PRESENCE | node→viewers, unsigned | 2 | `device_cid: uint`, `online: bool`, `agents: [tstr]`, `username: tstr` (the peer username for P2P) |
| 8 | JOIN_REQUEST | Endpoint key | 3 | `task_id`, `note: tstr ≤ 280 B`, `readiness: Readiness`, `agent_id?` |
| 9 | JOIN_ANSWER | owner Controller key | 3 | `request_id: bstr(32)` (the request's `signal_id`), `accept: bool`, `reason?` |
| 10 | TASK_WRITE | Endpoint key | 3 | `op: "create"\|"update"\|"delete"`, `task_id`, `fields: TaskFields` (empty map for `delete`) |
| 11 | ENROL / REVOKE | **identity (root) key**, or the Endpoint key with `assertion` | 3 | `op: "enrol"`: `endpoint_cid: uint, kind: "device"\|"controller", pubkeys: {sign: bstr(1952), seal?: bstr(1184)}, epoch: uint, assertion?: bstr` — `op: "revoke"`: `kid: bstr(32), epoch: uint` |
| 12 | SUGGESTION | Endpoint key | 3 | `task_id`, `text: tstr ≤ 2 KiB` |
| 13 | EVENT | node→viewers, unsigned | 2 | `project_id, cursor: uint, kind: tstr, body: EventBody` |
| 14 | NOTIFY | node→Person, unsigned | 2 | `event_id: bstr(32), kind, subject, text, at: uint ms` |
| 15 | SUBSCRIBE / UNSUBSCRIBE | Endpoint→node, unsigned | 2 | `op: "subscribe"\|"unsubscribe"`, `project_id`, `since_cursor: uint` |
| 16 | LINK_CODE / LINK_REDEEM | Endpoint key / unsigned | 3 / 2 | `op: "code"`: `code: tstr(8)` — `op: "redeem"`: `code, acting_username, install_id, node_id` |
| 17 | PROGRESS_TAIL | Device key, **P2P only** | 3 | `agent_id, at: uint ms, line: tstr ≤ 512 B` |

Named types (SW §2.1, §2.4, §2.5):
```
Lane       = "running" | "waiting" | "blocked" | "done" | "stalled"
Blocker    = { kind: "human" | "dependency" | "lock" | "disk" | "rate_limit", text: tstr ≤ 280 B, task_id?: tstr (iff dependency) }
Readiness  = uint 0..=1000      -- permille of SW §2.4 (1000 none, 0 human, 200 dependency, 500 lock/disk/rate_limit; min over blockers); no floats on the wire
Tier       = "off" | "aware" | "synchronized"
TaskFields = { title?: tstr ≤ 200 B, description?: tstr ≤ 4096 B, parent?: tstr, tier?: Tier, visibility?: "owner" | "members" | "summary",
               status?: "open" | "done" | "cancelled", owner?: tstr(16) id_fp,
               join_policy?: { mode: "manual" } | { mode: "auto", max_coworkers: uint 1..=64 },
               embedding?: [uint ≤ 65535] × 256 }   -- `create` requires title; the node recomputes the embedding from title+description and refuses a mismatch
EventBody  = { typ: 2 | 3 | 7 | 8 | 9 | 10, from: uint CID, iss: tstr(16), payload: map }   -- that type's payload after the visibility filter (a vis:owner task's title removed for non-owners)
```
ENROL rules: a Device enrol **requires** `seal`; a Controller enrol has no `seal`. `assertion`
(`sign-in-with-citadel.md` §6) is present iff `Signed.kid` is the enrolling Endpoint's own
signing key; then the node verifies the assertion against work.avarok.net's pinned server key and
`SHA3-256(pubkeys.sign)` must equal the kid in `assertion.device`. Without `assertion`,
`Signed.kid` must be the Person's root kid.

`aud` convention: `"synchronized.work"` for 1, 2, 3, 8, 9, 10, 11, 12, 15, 16; the recipient
Device CID for 4, 5; the Controller CID for 6 and 17. P2P-eligible: 3, 4, 5, 6, 17 (SW §4.8);
everything else is refused on the P2P path.

## 4. Person record (ServerDO, keyed by `id_fp`; `person-record` fixture)

```
{ 1: id_fp tstr(16), 2: pk bstr(1952), 3: display tstr, 4: endpoints [ { 1: cid uint, 2: kind tstr, 3: sign bstr(1952), 4?: seal bstr(1184), 5: epoch uint } ],
  5: epoch uint, 6: policy { "approval": "manual"|"auto", "rate_per_min": uint } }
```

## 5. Fixtures

| file | what it proves |
|---|---|
| `01-hello` | unsigned message in slot 2 |
| `02-status-update` | Device-signed Body; `kid`, nonce, seq, `aud` node, `lane: "running"` |
| `04-prompt-sealed` | Controller-signed, sealed to the Device's KEM key; `sw-wire-kat.json` gives the KEM seed, `m`, shared secret, HKDF-SHA3 key and the inner plaintext |
| `06-ack`, `17-progress-tail` | Device-signed, `aud` = Controller CID |
| `07-presence`, `15-subscribe` | unsigned node/Endpoint messages |
| `11-enrol`, `11-revoke` | root-signed by identity A of `identity-kat.json` (`kid = SHA3-256(pk_A)`, `iss = id_fp_A`) |
| `p2p-envelope` | the 2-entry text-keyed envelope carrying `17-progress-tail` |
| `person-record` | the stored Person |
| `invalid-*` | non-canonical bytes the decoder must refuse |

## 6. Decisions recorded here

- SHA3-256 for `kid`, `signal_id`, `rcpt` and HKDF-SHA3-256 for the seal (coordinator,
  2026-11-16): one hash family across the batch, matching the identity crate and the sign-in
  challenge. Supersedes SW rev 3 §4.2/§4.5's SHA-256.
- The `"sw-signed-v1" ‖ 0x00` prefix is new (the design named no domain): it keeps an ENROL
  signature by the identity key distinct from a binding, a well-known or an assertion signature.
- `SwMessage` carries `typ` beside the signed body so a relay can route without opening `Signed`.
- `Readiness` is a permille integer, not the design's `f32`, because the wire has no floats.
- S1's choices confirmed: CONTROL `id?` is `bstr(32)`; ENROL takes an optional `assertion`; a
  Device enrol requires `seal`.
