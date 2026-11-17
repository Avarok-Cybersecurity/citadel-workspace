# Contract: CW-1..3 `node_page` (SW rev 3 §7.2, plan §5.3) — FROZEN 2026-11-16

Schema: `node-page-envelope.schema.json` + `fixtures/node-page-envelope/`. Parties: manifest
types (H1), guest context (H1), UI (H1, after the UI fold), sw-app (S6).

## 1. CW-1 manifest and guest context

```rust
// citadel-workspace-types/src/apps_manifest.rs
pub enum AppSurface { CanvasPane, MdZone, NodeTab, NodePage }   // "node_page" on the wire
// apps_manifest_check.rs: `node_page`, like `node_tab`, requires a scope reaching a node (`workspace`, `node` or `node_tree`).
// citadel-internal-service/citadel-app-sdk-types/src/context.rs
pub enum Surface { CanvasPane, MdZone { zone_id }, NodeTab { tab_id }, NodePage {} }   // "node_page"
```
`NodePage {}` is an empty struct variant (serde: `{"node_page": {}}`), so a later field is
additive. The TS bindings regenerate (`AppSurface.ts`, `Surface.ts`); the stale-WASM rule applies.

## 2. CW-2 node metadata envelope (`citadel_app` key of the node's metadata document)

| v | shape | meaning |
|---|---|---|
| 1 (shipped) | `{ "v": 1, "kind": "citadel-app", "payload": { "app": "docs" \| "pdf" \| "latex" } }` | first-party document view (`DocumentView`), unchanged |
| 2 (new) | `{ "v": 2, "kind": "citadel-app", "payload": { "app": "<installed app id>", "install_id": "<opaque>" } }` | an installed app with the `node_page` surface, resolved against the install registry |

`deny_unknown_fields` at both levels; `app` in v2 follows the `citadel-app-id` grammar (2+
dot-separated labels of `[a-z0-9-]`, ≤ 64) and is **never** one of the v1 ids; `install_id` is
the kernel-minted opaque id of the install the node binds to. Decoder:
```ts
decodeNodeApp(metadata): { kind: 'none' } | { kind: 'document', app: 'docs'|'pdf'|'latex' } | { kind: 'installed', app: string, installId: string } | { kind: 'unreadable', reason: string }
```
An unknown version, a foreign `kind`, an unknown v1 app, a v2 app that is not installed (or lacks
`node_page`) is `unreadable` with a reason shown in place of the page: **a refusal, never a
default**. Writers merge into the metadata document (workspace-metadata convention), never assign
over it.

## 3. CW-3 render (UI)

- `WorkspaceView` routes `installed` to `AppNodePage`: the app runtime mounted with
  `Surface::NodePage {}`, sized to the pane, `AppEvent::Resize` on every pane resize, **no MDX
  chrome** (no editor toolbar, no zone frame); the node's chat and tabs stay reachable.
- Node menu: "New → App page…" lists installed apps whose manifest has `node_page` and whose
  scope reaches this node; choosing one writes the v2 envelope.
- Sidebar: the app's icon (`node-icon.ts`) for v2 nodes, as the document icons for v1.

## 4. Tests (plan §4 H1 row)

Manifest fixture with `node_page`; `decodeNodeApp` table (the fixtures here: v1 three kinds
unchanged, v2 installed, every `invalid-*` → `unreadable`); render test: the installed kind mounts
the runtime with `Surface::NodePage` and no MDX chrome (control: route `installed` to
`DocumentView` → red).
