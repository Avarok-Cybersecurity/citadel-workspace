# One account in several browsers (multi-subscriber CIDs)

Owner request and go-ahead: 2026-09-27. Design researched with Fable (one read-only run, at the
owner's request); the design's key claims were spot-checked against the code.

## Goal

The same account (CID K) open in several tabs and several browsers at once, every one showing the
same conversation state, with no browser able to diverge from another.

## Design (decided)

- **The agent owns per-CID truth.** Chat pages already live in the agent's LocalDB
  (`citadel-workspaces/src/lib/storage-utils.ts:20-25`); ILM's durable state does too, but ILM
  itself runs in each browser's WASM and rewrites its whole tracker map on every send
  (`intersession-layer-messaging/src/message_tracker.rs:300-303`), so it cannot run in two places.
- **One ordered event stream per CID.** The agent turns every accepted intent and every inbound
  event into a `ConversationEvent { cid, seq, kind }` and sends it to every subscriber of K,
  including the one that caused it. Browsers render only from events; requests are intents. The
  originator still gets its `request_id`-correlated reply, so errors surface as today.
- **Catch-up.** A subscriber joining late loads the agent-written pages (a snapshot) and replays
  events with a higher `seq` from a bounded per-CID ring; older than the ring, it resyncs.
- **First wins** for one-off choices shown to every subscriber: `RespondFileTransfer` already takes
  the handle once; `MediaOpen` already has a single owner. The agent announces the outcome so the
  other subscribers dismiss the offer.
- **Security unchanged in kind.** A connection joins K only after the password check or by claiming
  an orphaned session; fan-out goes only to K's subscribers; the Origin allowlist stays.

## Safety across phases

Until phases 2 and 3 land, two browsers sending for one CID would corrupt ILM and the pages. So the
whole feature is behind an agent setting, `multi_subscriber`, **off by default**: off, behaviour is
exactly today's (one owner; the takeover prompt moves the session). It is turned on only when all
three phases are in and the two-browser specs (one machine and two machines) pass.

## Ordering constraint (found in phase 1)

Inbound P2P reaches the browser as raw ILM frames that the browser's ILM acknowledges and records
(`requests/peer/connect.rs` P2P-RECV, `responses/peer_channel_created.rs`). A session must therefore
never gain a reader while ILM runs in the browser: two ILMs would process the same frames. Readers
are added only in phase 3, after phase 2 moves ILM into the agent.

## Phases (each its own PR, tests + negative controls, merged bottom-up)

1. **Subscriber set + fan-out** (agent). `SessionRoute` owner (`Arc<AtomicUuid>`) becomes a
   subscriber set; `send` fans out; `connect.rs` / `connection_management_claim.rs` insert
   instead of replace when the setting is on; `ext.rs` removes a dropped connection; the
   ownership gate (`requests/mod.rs`) checks membership. ~45 uses of
   `associated_localhost_connection` across 23 files (`citadel-internal-service/src`).
2. **ILM into the agent.** Implement `intersession_layer_messaging::Backend` over the agent's KV
   store and `UnderlyingSessionTransport` over the peer sinks; one ILM per CID in the agent;
   `requests/message.rs` sends through it; inbound P2P feeds it; the WASM messenger stops running
   ILM for agent-hosted sessions.
3. **Per-CID event stream.** A per-CID actor serialises intents, mints message id/index/seq,
   writes the pages, keeps a bounded ring, fans out `ConversationEvent`; `Subscribe`/`Resume`
   requests; the UI drops optimistic writes (`message-sender.ts`) and renders from events; the
   in-browser one-tab-per-CID rule (`claim-session.ts`) is lifted.
4. **Turn it on.** Default `multi_subscriber` on, after the two-browser specs pass; agent release.

## Status

- [x] Phase 1 (citadel-agent #78, parent #172): `SessionSubscribers` (owner + readers, owner semantics unchanged), `SessionRoute` fans out, a closed connection leaves every session (an owner with readers is replaced), the gate admits a reader. No reader can be added yet.
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
