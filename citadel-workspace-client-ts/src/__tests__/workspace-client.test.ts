import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceClient } from '../WorkspaceClient.js';
import type { WorkspaceClientConfig } from '../WorkspaceClient.js';
import type {
  ConnectSuccess,
  InternalServiceRequest,
  InternalServiceResponse,
  WasmConnectOptions,
} from 'citadel-internal-service-wasm-client';

/**
 * SBIO: the correlation and routing logic under test is pure observer logic;
 * this subclass replaces only the two I/O touchpoints (the WASM send and the
 * WASM connect) so tests inject traffic through the real message handler.
 */
class TestClient extends WorkspaceClient {
  public sent: InternalServiceRequest[] = [];
  public failSend = false;

  override async sendDirectToInternalService(request: InternalServiceRequest): Promise<void> {
    if (this.failSend) {
      throw new Error('transport down');
    }
    this.sent.push(request);
  }

  override async connect(): Promise<ConnectSuccess> {
    // Test-only: auth.connect() needs a cid to establish its local session;
    // everything else about the real connect is WASM I/O, out of scope here.
    return { cid: BigInt(42), request_id: null };
  }
}

function makeClient(received?: InternalServiceResponse[]): {
  client: TestClient;
  config: WorkspaceClientConfig;
} {
  const config: WorkspaceClientConfig = {
    websocketUrl: 'ws://test-not-connected',
    messageHandler: (message) => {
      received?.push(message);
    },
  };
  // The WorkspaceClient constructor replaces config.messageHandler with its
  // wrapping closure — invoking config.messageHandler afterwards simulates a
  // message arriving from the WASM layer.
  const client = new TestClient(config);
  return { client, config };
}

// Rationale for the empty options cast: connect() is overridden above and
// never reads its options; building a full WasmConnectOptions would only
// duplicate fields no code path touches.
const FAKE_CONNECT_OPTIONS = {} as WasmConnectOptions;

void test('DEFECT A: getSession() resolves with the response matching its own request_id', async () => {
  const { client, config } = makeClient();
  await client.auth.connect(FAKE_CONNECT_OPTIONS);

  const pending = client.auth.getSession(1000);

  // The request must actually have been sent, carrying a request_id.
  assert.equal(client.sent.length, 1);
  const sentRequest = client.sent[0] as { GetSessions: { request_id: string } };
  const requestId = sentRequest.GetSessions.request_id;
  assert.equal(typeof requestId, 'string');

  // A GetSessionsResponse for some OTHER request must not resolve it...
  config.messageHandler!({
    GetSessionsResponse: { cid: BigInt(42), sessions: [], request_id: 'someone-elses-request' },
  } as unknown as InternalServiceResponse);

  // ...and the matching one must.
  config.messageHandler!({
    GetSessionsResponse: { cid: BigInt(42), sessions: [], request_id: requestId },
  } as unknown as InternalServiceResponse);

  const result = await pending;
  assert.ok(result);
  assert.equal(result.request_id, requestId);
  assert.equal(result.cid, BigInt(42));
});

void test('DEFECT A: transport errors propagate instead of being swallowed into null', async () => {
  const { client } = makeClient();
  await client.auth.connect(FAKE_CONNECT_OPTIONS);
  client.failSend = true;

  // The old implementation caught everything and returned null, which was
  // indistinguishable from "no session".
  await assert.rejects(client.auth.getSession(1000), /transport down/);
});

void test('getSession() returns null only when there is no local session', async () => {
  const { client } = makeClient();
  assert.equal(await client.auth.getSession(1000), null);
  assert.equal(client.sent.length, 0); // nothing to query — nothing sent
});

void test('nextResponse() rejects on timeout', async () => {
  const { client } = makeClient();
  await assert.rejects(client.nextResponse(() => undefined, 10), /Timed out after 10ms/);
});

void test('nextResponse() observes without consuming: the message still reaches the handler', async () => {
  const received: InternalServiceResponse[] = [];
  const { client, config } = makeClient(received);

  const pending = client.nextResponse(
    (message) => ('GetSessionsResponse' in message ? message : undefined),
    1000
  );
  const response = {
    GetSessionsResponse: { cid: BigInt(1), sessions: [], request_id: 'r1' },
  } as unknown as InternalServiceResponse;
  config.messageHandler!(response);

  assert.equal(await pending, response);
  assert.deepEqual(received, [response]); // still delivered downstream
});

void test('DEFECT D: a MessageDelivered message passes through unparsed and cannot touch session state', async () => {
  const received: InternalServiceResponse[] = [];
  const { client, config } = makeClient(received);
  client.session.setWorkspaceSession('ws-1', 'Workspace One');

  // No Rust crate produces MessageDelivered; the branch that parsed it was
  // dead code — but had it run, this spoofed payload would have cleared the
  // workspace session through the unguarded JSON.parse path.
  const contents = Array.from(
    new TextEncoder().encode(JSON.stringify({ Response: { Error: 'Not in workspace' } }))
  );
  const fake = { MessageDelivered: { contents } } as unknown as InternalServiceResponse;
  config.messageHandler!(fake);

  // Passed through unchanged: no enrichment key, same object.
  assert.equal(received.length, 1);
  assert.equal(received[0], fake);
  assert.ok(!('WorkspaceDelivered' in (received[0] as object)));

  // And the workspace session survived.
  assert.equal(client.session.getCurrentWorkspaceSession()?.workspaceId, 'ws-1');

  client.session.dispose();
});
