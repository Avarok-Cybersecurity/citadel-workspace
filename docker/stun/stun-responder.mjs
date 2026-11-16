#!/usr/bin/env node
/**
 * Loopback STUN responders for the dev and CI stack (docker-compose.yml `stun`).
 *
 *   node stun-responder.mjs serve   answer binding requests on every endpoint listed
 *   node stun-responder.mjs probe   exit 0 only when every endpoint answers
 *
 * The endpoints are the agent's own list, INTERNAL_SERVICE_STUN_SERVERS, so the stack
 * names them once (docker-compose.yml) and the agent cannot be pointed at a responder
 * that is not there. Every entry must be 127.0.0.1:<port>; there is no default.
 * Why loopback at all is in stun-wire.mjs.
 */
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { bindingRequest, bindingRequestId, bindingSuccess, mappedAddress } from './stun-wire.mjs';

const HOST = '127.0.0.1';
const PROBE_TIMEOUT_MS = 2000;

const STUN_SERVERS_ENV = 'INTERNAL_SERVICE_STUN_SERVERS';

function ports(spec) {
  if (spec === undefined || spec === '') throw new Error(`${STUN_SERVERS_ENV} is not set; it names the endpoints to answer on`);
  const list = spec.split(',').map((entry) => {
    const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(entry);
    const port = match ? Number(match[1]) : NaN;
    if (!(port > 0 && port <= 0xffff)) throw new Error(`${STUN_SERVERS_ENV} entry ${JSON.stringify(entry)} is not 127.0.0.1:<port>`);
    return port;
  });
  if (list.length < 3 || new Set(list).size !== list.length) {
    throw new Error(`${STUN_SERVERS_ENV} must name at least three distinct ports (got ${JSON.stringify(spec)})`);
  }
  return list;
}

function serve(port) {
  const socket = createSocket('udp4');
  socket.on('message', (packet, from) => {
    const id = bindingRequestId(new Uint8Array(packet));
    if (id === null) return;
    socket.send(bindingSuccess(id, from.address, from.port), from.port, from.address);
  });
  socket.on('error', (err) => { console.error(`stun ${HOST}:${port}: ${err.message}`); process.exit(1); });
  socket.bind(port, HOST, () => console.log(`stun: answering binding requests on ${HOST}:${port}`));
}

function probe(port) {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const id = new Uint8Array(randomBytes(12));
    const timer = setTimeout(() => { socket.close(); reject(new Error(`${HOST}:${port} did not answer`)); }, PROBE_TIMEOUT_MS);
    socket.on('message', (packet) => {
      const mapped = mappedAddress(new Uint8Array(packet), id);
      if (mapped === null) return;
      clearTimeout(timer);
      socket.close();
      resolve(mapped);
    });
    socket.on('error', (err) => { clearTimeout(timer); socket.close(); reject(err); });
    socket.send(bindingRequest(id), port, HOST);
  });
}

const [mode] = process.argv.slice(2);
const list = ports(process.env[STUN_SERVERS_ENV]);
if (mode === 'serve') {
  list.forEach(serve);
} else if (mode === 'probe') {
  Promise.all(list.map(probe)).then(
    () => process.exit(0),
    (err) => { console.error(`stun probe: ${err.message}`); process.exit(1); },
  );
} else {
  throw new Error(`mode must be "serve" or "probe" (got ${JSON.stringify(mode)})`);
}
