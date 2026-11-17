/**
 * Clicking someone in the Messages page's Available list sends them a request.
 *
 * The list used a typed-CID form's hook: `setValue(cid)` then `submit()` in the
 * same click, and `submit` read the value from the render before -- empty -- so
 * it returned without sending anything (found 2026-09-30). The CID is passed in.
 * Real: the hook. Stood in: the registration call (agent I/O).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeerRequest, type PeerRequest } from '../use-add-peer';

describe('usePeerRequest', () => {
  it('sends the request for exactly the CID it is given, in one call', async () => {
    const sent: bigint[] = [];
    let refreshed: number = 0;
    const { result } = renderHook((): PeerRequest => usePeerRequest(async (cid: bigint) => { sent.push(cid); }, () => { refreshed += 1; }));
    await act(async (): Promise<void> => { await result.current.request(8971774964460040856n); });
    expect(sent).toEqual([8971774964460040856n]);
    expect(refreshed).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("shows the server's refusal instead of swallowing it", async () => {
    const { result } = renderHook((): PeerRequest => usePeerRequest(async () => { throw new Error('Peer already registered'); }, () => undefined));
    await act(async (): Promise<void> => { await result.current.request(42n); });
    expect(result.current.error).toBe('Peer already registered');
  });
});
