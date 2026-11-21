import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedPorts } from './fixed-ports.mjs';

test('the shapes the gates used to have are each found', () => {
  const old = [
    'const PORT = Number(process.env.A11Y_PORT ?? 4186);',
    'const PORT = 4189;',
    "process.exit(await runChecks(CHECKS, Number(process.env.SWEEP_PORT ?? 4198)));",
    "await preview({ preview: { port, strictPort: true } });",
    "spawn('npx', ['vite', 'preview', '--port', '4203']);",
    'server.listen(4176, () => ok(server));',
  ].join('\n');
  assert.deepEqual(fixedPorts(old).map((f) => f.line), [1, 1, 2, 3, 4, 5, 6]);
});

test('ports chosen per run, and the closed agent ports, pass', () => {
  const now = [
    'const PORT = await freePort(); // chosen per run',
    "await preview({ preview: { port: 0, strictPort: true, host: '127.0.0.1' } });",
    'const DEAD_AGENT_PORT = Number(process.env.AGENT_DOWN_AGENT_PORT ?? 12399);',
    "spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort']);",
    'server.listen(PORT, () => ok(server));',
  ].join('\n');
  assert.deepEqual(fixedPorts(now), []);
});
