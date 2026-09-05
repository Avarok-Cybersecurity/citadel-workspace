/**
 * Node content must not be broadcast to every connected socket.
 *
 * `NodeContentUpdated` carries the document body and `Node` carries the whole record. Both
 * went out with `BroadcastAudience::Everyone`, and the per-connection forwarding loop gated
 * only `Group` — so a member removed a moment ago, whose socket is still open, received the
 * body of every document anyone saved afterwards, and where one server holds several
 * workspaces, so did the other one's members. The pull path has always checked `ViewContent`.
 *
 * The forwarding loop's decision is covered by tests/a_broadcast_is_not_a_permission.rs. This
 * guards the other half — that these two responses keep going out node-scoped — because
 * `kernel.broadcast(...)` is the easier call to reach for and nothing else would notice.
 */
import { readFileSync } from 'node:fs';

const FILE =
  'citadel-workspace-server-kernel/src/kernel/command_processor/async_process_command.rs';
const source = readFileSync(FILE, 'utf8');
const problems = [];

// Exactly the two payloads that carry content, and the call each must go out on. Written as
// the statement rather than a proximity search: `Node` is a prefix of `NodeContentUpdated`,
// and an earlier version of this gate matched the wrong one and then failed in every state,
// including the correct one — a gate that is always red teaches people to ignore it.
const REQUIRED = [
  {
    what: 'the document body (NodeContentUpdated)',
    good: /kernel\.broadcast_to_node\(\s*broadcast_response\s*,/,
    bad: /kernel\.broadcast\(\s*broadcast_response\s*,/,
  },
  {
    what: 'the node record (WorkspaceProtocolResponse::Node)',
    good: /kernel\.broadcast_to_node\(\s*WorkspaceProtocolResponse::Node\(/,
    bad: /kernel\.broadcast\(\s*WorkspaceProtocolResponse::Node\(/,
  },
];

for (const { what, good, bad } of REQUIRED) {
  if (bad.test(source)) {
    problems.push(`${what} is sent with kernel.broadcast — audience Everyone — and must be node-scoped`);
  } else if (!good.test(source)) {
    problems.push(`${what} is no longer sent with broadcast_to_node; this gate is reading a shape that has gone`);
  }
}

if (problems.length) {
  problems.forEach((p) => console.error(`::error file=${FILE}::${p}`));
  console.error('FAIL: node content must reach only sessions entitled to view that node.');
  process.exit(1);
}
console.log('OK: the document body and the node record are both broadcast node-scoped.');
