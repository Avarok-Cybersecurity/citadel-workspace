/**
 * The server broadcasts NodeContentUpdated to every member EXCEPT the one who
 * saved, so this response is the only way anybody else learns a document
 * changed. It was the one variant of 25 with no handler on this side: the
 * editor saw their own change and everyone else kept rendering the copy they
 * loaded until they navigated away and back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { handleNodeVariants } from '../node-handlers';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from '../workspace-handlers';

const connection: ConnectionInfo = { request_id: 'req-1', cid: 1n } as unknown as ConnectionInfo;

function contentUpdated(overrides: Record<string, unknown> = {}): WorkspaceProtocolResponse {
  return {
    NodeContentUpdated: {
      node_id: 'node-7',
      mdx_content: '# Edited by someone else',
      updated_by: 'user-2',
      timestamp: 1700000000,
      ...overrides,
    },
  } as unknown as WorkspaceProtocolResponse;
}

describe('NodeContentUpdated', () => {
  let emit: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { emit = vi.spyOn(eventEmitter, 'emit'); });
  afterEach(() => { emit.mockRestore(); });

  it('is claimed by the node handler', () => {
    // Returning false would leave the response to fall through unhandled,
    // which is what it did before.
    expect(handleNodeVariants(contentUpdated(), connection)).toBe(true);
  });

  it('announces the new content, not merely that something changed', () => {
    handleNodeVariants(contentUpdated(), connection);
    const call: unknown[] | undefined = emit.mock.calls.find((c) => c[0] === 'node:content-updated');
    expect(call, 'no node:content-updated was emitted').toBeTruthy();
    // The payload has to carry the content itself: a bare "something changed"
    // would force a refetch, which is the behaviour this replaces.
    expect(call?.[1]).toMatchObject({
      nodeId: 'node-7',
      mdxContent: '# Edited by someone else',
      updatedBy: 'user-2',
    });
  });

  it('passes the request id through, so state can track what it applied', () => {
    handleNodeVariants(contentUpdated(), connection);
    const call: unknown[] | undefined = emit.mock.calls.find((c) => c[0] === 'node:content-updated');
    expect((call?.[1] as { connection: ConnectionInfo }).connection).toBe(connection);
  });

  it('leaves unrelated variants alone', () => {
    const other: WorkspaceProtocolResponse = { SomethingElse: {} } as unknown as WorkspaceProtocolResponse;
    expect(handleNodeVariants(other, connection)).toBe(false);
  });
});
