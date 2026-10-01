# One account in several windows: the agent as the hub

The owner asked for this on 2026-10-01. It ships as agent 0.8.6+, in stacked PRs `feat/mw1`…`feat/mw6`. Each
PR uses the same branch name in the agent, the UI and the parent.

The owner chose this design: **ILM runs in the agent.** Every window (a tab, another browser, the
installed PWA) is an equal subscriber to the session. The agent owns reliable delivery and the 1:1
conversation store. Windows read, render and send intents.

The earlier plan `multi-browser-cid.md` (agent #78–#81, parent #172–#175) was used as reference only. This
plan supersedes it.

## Why the agent, and not one "primary" window

- **ILM must run in exactly one place per CID.** The receiver's per-source frontier
  (`message_tracker.rs` `safe_to_ack`: `msg_id <= frontier`) treats a second ILM's lower id sequence as
  duplicates: every message it sends is ACKed and dropped. Each ILM also rewrites its whole tracker map
  in LocalDB.
- **A window is a bad host for it.** A primary window would make delivery depend on a tab staying awake
  and unthrottled, and a frozen or discarded tab stalls every other window.
- **The agent outlives windows.** It is always running while the account is signed in. So it can receive
  and persist with no window open, and windows catch up from the store when they attach.

## Phases

| PR | Contents |
|---|---|
| **mw1** | **Subscriber set, fan-out, attach.** `SessionSubscribers` (ordered; primary first only for role reporting); every session notification fans out; a request's response goes only to the requester; a drop detaches only itself; `AttachSession { cid, proof: Password \| Token }`; the sealed in-memory token; `SessionRoleNotification` (Primary/Secondary/Detached); legacy takeover kept. Agent only (no UI yet: two browser ILMs on one CID would be unsafe before mw5). |
| **mw2** | **Connector backend split.** The ILM `Backend` becomes generic over a `KvStore` seam: the browser's request-based store, and the agent's direct LocalDB store, using the SAME `{prefix}-{cid}` keys so the agent adopts the tracker state a browser persisted. The wire encode and decode are shared by both, never duplicated. |
| **mw3** | **Agent ILM host + wire.** One ILM per signed-in CID. It runs for the session's lifetime with or without a window. The transport is the peer sinks. Frames from both P2P read streams are fed to it. A `SendReliable` request's response means "accepted by ILM". Byte-identity tests and a two-agent test with mixed hosting (one agent-hosted, one browser-style ILM) are part of it. |
| **mw4** | **Agent conversation store + event stream.** See the sections below. |
| **mw5** | **WASM/UI switch-over + migration guard.** A capability handshake: the UI uses agent ILM and the agent store when the agent offers them. "Open here too", the remembered join, and Detached handling. |
| **mw6** | **Native notifications from the agent.** See the phase 6 section. |

## mw1: routing table

| Traffic | Delivered to |
|---|---|
| A handler's response to request R (carries R's `request_id`) | only the connection that sent R (`HandledRequestResult.uuid`) |
| Session notifications: C2S and P2P messages, peer register/connect/disconnect, `PeerPathChanged`, file-transfer offers and ticks, group notifications, `ServerConnectionLost`/`Reconnected`/`ReconnectFailed`, SDK-originated `DisconnectNotification`, and the conversation events added in mw4 | every attached connection |
| `Disconnect` (logout), `PeerDisconnect` | the requester gets the response. Every other member gets `DisconnectNotification` with `request_id: None`. |
| Call media lane | the connection that opened the call. A call lives in one window; "first wins" for answering. |
| `SessionRoleNotification` | each member gets its role, and displaced connections get `Detached`. It is sent only when a change involves more than one connection. |

**Attach authorization.**

- Joining a live session takes the password or a token.
  - **Password:** checked by `credential_fingerprint::derive` and `matches`, the same check the live
    `Connect` makes.
  - **Token:** minted by a successful password attach: 32 bytes from the OS RNG, held only in agent
    memory, compared in constant time with the same `matches`. There are at most 8, and they die with
    the session.
- A failed proof changes nothing.
- Orphans are still reclaimable proof-free through `ClaimSession`, as today.
- A live `Connect` from an older UI keeps today's takeover semantics. The caller becomes the only
  member, and the displaced windows are told `Detached`.
- The ownership gate admits any member, and nothing else.

**In the browser,** the token is sealed with AES-GCM under a non-extractable WebCrypto key in IndexedDB.
It is never stored as plaintext. This protects it against anyone reading the storage. It does not
protect it against script running in the origin, which nothing could.

## mw3: the agent ILM

- **Registry.** `kernel/ilm/` holds `AgentIlmRegistry { cid -> host }`.
  - A host starts at a successful `Connect` or a reconnect `put_link`.
  - It stops at logout, deregister, or a server give-up.
  - Stopping it drops the ILM; its state is already durable in LocalDB.
  - One host per CID is enforced. The slot is reserved before the async load.
- **Backend.** `CitadelWorkspaceBackend<AgentKvStore>` over the agent's LocalDB, with the same keys:
  `inbound_messages-`, `outbound_messages-`, `last_acked-`, `last_sent-`, `next_unique_id-`,
  `received_messages-`, `last_received_from-`.
- **Transport.** `UnderlyingSessionTransport` over `conn.peers[peer].sink`, re-resolved on every send, so
  a re-handshake is followed.
- **Inbound.** Both read streams call `feed(frame)`.
  - An ILM data or control frame goes to the CID's ILM.
  - A non-frame (Yjs, raw) keeps today's raw fan-out.
  - This uses the current decoder (#83 piggybacked ACKs, #84 codecs) from the shared wire module.
- **Local delivery.** `LocalDelivery::deliver` hands the decoded P2P payload to mw4's store. **ILM's
  acknowledgement waits for persistence, not for a window.** A message the agent stored is delivered:
  windows read it from the store. Until mw4 lands, delivery fans the decoded `MessageNotification` out
  to subscribers, and fails when there are none, so ILM keeps the message.
- **Outbound.** `SendReliable { request_id, cid, peer_cid, message, security_level, compression_hint }`.
  Its response is `SendReliableAccepted` or `MessageSendFailure`.
- **Peers.** A remote peer may run browser ILM on an older agent. The frames are byte-identical because
  both sides use the same wire module. Tests pin this:
  - The `Message` bytes the agent transport emits equal the bytes a browser messenger emits for the
    same frame.
  - In a two-agent test, A is agent-hosted and B is a native `CitadelWorkspaceMessenger`, which is what a
    browser runs. Messages flow both ways exactly once, and in order, across a reconnect.

## mw4: the agent conversation store (single writer)

The agent becomes the **only** writer of the 1:1 conversation store, under one per-peer lock. This uses
the format the UI reads today, unchanged. Old pages stay readable, and so do the agent's writes.

**Keys.**

- In LocalDB bucket 0: `msgs_with_peer_{own}_with_{peer}_metadata` and `_{page}`, plus the legacy
  `msgs_with_peer_{peer}_*` read fallback with its `ownerCid` rule.

**Values.**

- **Pages and metadata:** UTF-8 JSON in the UI's field names (camelCase), with CIDs as decimal strings.
  Optional fields are omitted when absent. There are 50 messages per page.
- **Reactions:** a CBOR array, stored as a JSON number array. CIDs are encoded as 0x1b, `at` as float64,
  and maps use 16-bit headers.

**Algorithms** are ported from `message-pagination-store.ts` and the files it imports:

- **Append:** de-duplicate across the newest two pages, then roll the page over, place the message, and
  record it.
- **Status:** follows the ladder pending < sent < delivered < read, with `failed` only below delivered.
  The ladder is applied on disk too, which fixes the UI's off-memory overwrite.
- **Reactions:** one entry per reactor and emoji, last-writer by `at`, with tombstones.
- **Edit and delete:** only the sender may do them.
- **Remove:** as in `message-metadata-mutations.ts`.
- **Unread count:** as in `message-metadata-mutations.ts`.
- **Delete scope:** as in `message-page-delete.ts`.
- **Retention:** as in `retention.ts`.

**P2P commands.** These are cbor-x default encoding. Maps use 16-bit headers in insertion order, bigint
is always 0x1b, numbers outside the int32 range are float64, and `undefined` is 0xf7 with the key kept.
A Rust codec reproduces this, and a fixture test decodes bytes that the UI's cbor-x encoded.

**Inbound.** ILM delivers a P2P payload to the agent, which handles it by kind:

- **`MessagingLayer::Message`:**
  1. The stranger gate runs. It uses the account preference plus the agent's own registry.
  2. The message is appended with status `delivered`.
  3. The agent sends the app-level `MessageAck{delivered}` itself, because it is the one that persisted.
  4. A `ConversationEvent` is sent.
- **`MessageAck`:** applies the ladder and sends an event.
- **Edit, delete, reaction:** applied, and an event is sent.
- **A screenshot notice:** stored as a `system_notice` if the account preference asks for it.
- **Everything else** (typing, presence, CheckState, calls, files, RevFS, Yjs) is not persisted. It is
  fanned out to windows as the decoded `MessageNotification`, as today.

**Requests from windows.**

- `ConversationSend { cid, peer_cid, content, message_type, reply_to, mentions, attachments, document_* }`:
  the agent mints the id, index and timestamp, appends `pending`, sends through ILM, then marks `sent`
  or `failed`.
- `ConversationResend`, `ConversationEdit`, `ConversationDelete`, `ConversationReact`,
  `ConversationMarkRead { up_to }`: the agent sends read ACKs if the preference allows.
- `ConversationClear`.
- `SetAccountPreferences`: send read receipts, accept strangers, notify on screenshot, notification
  preview, and per-peer retention. These live in browser localStorage today, where the agent cannot see
  them. The windows push them, and the agent stores them per account.

**`ConversationEvent { cid, peer_cid, seq, kind, account_username, peer_username, conversation_id, preview }`**

- `kind` is one of `Appended(P2PMessage)`, `Updated(P2PMessage)`, `Removed(id)`, `Cleared`, `Expired`,
  or `Metadata`.
- It is fanned out to every subscriber.
- The fields cover what phase 6 needs: account, kind, peer, conversation id and preview text.
- `seq` is per CID. A window that sees a gap re-reads the store, which is the snapshot, so no ring buffer
  is needed.

The retention sweep runs in the agent, hourly per account.

**As built (agent #99):**

- The Rust types in `citadel-internal-service-types` (`conversation.rs`, `conversation_api.rs`) are the
  one definition, and the TypeScript is generated from them.
- No field is skipped on the wire, because TCP clients speak bincode. The stored JSON omits absent
  fields itself. `kernel/conversations/stored.rs` is the only place the on-disk differences live.
- Fixtures written by the UI's own encoder pin both the cbor-x and the stored-JSON compatibility.
- An unreadable peer registry reads as "known", as the UI's stranger gate does.
- The WASM client grew from 4.0 MB to 4.8 MB. Measured with twiggy, that is +377 KB of function-name
  debug data and +442 KB of code:
  - ~307 KB is serde for the new types, in the three formats the client speaks;
  - ~38 KB is derived `Clone` on the larger request enum.

  No agent-only code and no ts-rs is linked into the client. The name section was 1.9 MB, 40% of the
  binary. Nothing removed it, because wasm-opt is off for CI determinism. It is now stripped after
  wasm-bindgen (`scripts/strip-wasm-names.mjs`, which `sync-wasm-clients.sh` and the build script
  both run), so the glue is untouched. `check-wasm-ships-without-names.mjs` gates it. The shipped
  binary is 2.86 MB, below master's 3.69 MB, and the precache cap stays at 4 MiB.

## mw5: switch-over and migration guard

- **Capability handshake.** The WASM client sends `DeclareCapabilities { agent_ilm: true,
  conversation_store: true }` on every socket. The agent answers with its own capabilities.
  - **New UI on a new agent:** the UI never opens a browser ILM. It sends through `ConversationSend`,
    renders from the store and events, and stops all page read-modify-writes.
  - **New UI on an old agent:** today's behaviour, and "Open here too" is not offered.
- **Old UI tab on a new agent.** It never declares, so it would run browser ILM against a hosted CID.
  It is refused cleanly at the door instead:
  - `Connect`, `ClaimSession` and `AttachSession` from an undeclared connection get "This page is older
    than your Citadel agent. Reload it to continue."
  - LocalDB writes to ILM or conversation keys of a hosted CID are refused, as are `Message` requests
    that carry ILM frames.
  - It is never left running in a mixed state.
- **UI.**
  - "<user> is open in another window" becomes **Open here too**. The same sign-in prompt (password or
    passkey) sends `AttachSession`, and the other window keeps working.
  - The token is remembered, sealed, per browser. A remembered browser re-attaches without prompting; a
    refused token is deleted, and the prompt is shown.
  - `Detached` shows the existing held-elsewhere notice.
  - Every window still routes by cid. The leader/follower tab model inside one browser is unchanged.

### As built (mw5)

- The handshake has two halves. The agent's greeting, `ServiceConnectionAccepted.agent_ilm`, says
  whether it hosts, so no window waits on an older agent that never answers a declaration. A window
  that is told yes declares `DeclareCapabilities { agent_ilm: true }` and awaits `AgentCapabilities`
  before anything else on that socket: requests are handled in parallel, and a claim sent beside the
  declaration could overtake it and be refused as an older page. `conversation_store` was folded into
  `agent_ilm`: one cannot be had without the other.
- Followers do not declare; they ask the leader what its socket was told (`__agentCapabilitiesProxy`).
- A `ConversationSend`'s Appended event carries the send's `request_id`, so the asking window clears
  its composer when its own bubble is on screen. `ConversationEvent` and `SessionRoleNotification`
  are therefore CID-routed in the browser; routed by request id the event would consume the pending
  entry the answer needs.
- Every window applies events through one ordered queue; a `seq` gap or reset re-reads.
- Retention: the window's runner prunes nothing when hosted; a changed period is told to the agent
  (`SetAccountPreferences`, which sweeps on hearing), and its count is reported from the store.
- "Open here too" joins with the password or a passkey (the passkey unlocks the password, which is
  the attach proof). The token is sealed with AES-GCM, the session's cid bound in as additional data,
  under a non-extractable key in IndexedDB. A silent re-join happens inside the claim
  (`claim-session.ts`), so every way into a session gets it.
- The browser page writer (`message-pagination-store.ts`, `message-page-operations.ts`) stays, marked
  as the path for agents before 0.8.6. It goes once no supported agent predates 0.8.6.

## mw6: native notifications from the agent (after mw5)

Planned in [multi-window-mw6-notifications.md](multi-window-mw6-notifications.md).

## Failure modes

- **A window drops.** It detaches. The ILM, the store and the other windows carry on. With no window,
  the agent still receives, persists and ACKs.
- **The agent restarts.** ILM state and pages are durable in LocalDB. Sessions are re-established by
  sign-in, as today.
- **A peer runs an older agent with browser ILM.** It interoperates byte-identically (mw3 tests).
- **An old UI tab.** It is refused at the door with a reload prompt, never run mixed.
- **Two windows act at once.** Both actions are requests to the one writer, and are serialised per peer.
- **Logout from any window** ends the session for all of them, and all of them are told.
