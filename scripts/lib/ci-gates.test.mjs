import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argv, deriveGates, gateChains, nodeRequirement } from './ci-gates.mjs';
import { matrixRows, parseFlowMap, readJobs, stepRuns, workflowEnv } from './workflow-steps.mjs';

const WORKFLOW = `name: t
env:
  SKIP_WASM_BUILD: "1"
  TOKEN: \${{ secrets.X }}
jobs:
  lint:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - project: citadel-workspaces
            path: citadel-workspaces
          - project: integration-tests
            path: citadel-workspaces/integration-tests
    defaults:
      run:
        working-directory: parent
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Static
        if: matrix.project == 'citadel-workspaces'
        run: npm run check:gates-invoked
        working-directory: parent/citadel-workspaces
      - name: Root gate, job default directory
        run: node scripts/check-file-length.mjs --strict # trailing comment
      - name: Shell logic is not a gate
        run: |
          if [ -n "x" ]; then
            npx tsc -p \${{ matrix.path }}/tsconfig.app.json
          fi
      - name: Chained
        run: node scripts/check-a.mjs && node --test scripts/lib/a.test.mjs
      - name: Diagnostics
        if: failure()
        run: node scripts/dump-logs.mjs
  polish:
    strategy:
      matrix:
        gate:
          - { name: Chat polish, run: 'npm run check:chat-polish' }
          - { name: Sweep, run: 'npm run check:ui-sweep' }
    defaults:
      run:
        working-directory: parent
    steps:
      - name: Install Chromium
        run: npx playwright install chromium
      - name: \${{ matrix.gate.name }}
        run: \${{ matrix.gate.run }}
        env:
          POLISH_ENGINES: chromium
        working-directory: parent/citadel-workspaces
      - name: Bundle
        run: npm run build && npm run check:bundle
        working-directory: parent/citadel-workspaces
`;

const resolveDir = (wd) => {
  if (wd !== 'parent' && !wd.startsWith('parent/')) throw new Error(`outside: ${wd}`);
  return `/root${wd.slice('parent'.length)}`;
};
const gates = () => deriveGates({ text: WORKFLOW, source: 'ui', resolveDir, seen: new Map() });

test('flow maps keep quoted commas and strip quotes', () => {
  assert.deepEqual(parseFlowMap("{ name: A, run: 'npm run x, y' }"), { name: 'A', run: 'npm run x, y' });
});

test('matrix rows: include lists, flow-map axes, and an empty matrix', () => {
  const jobs = readJobs(WORKFLOW);
  assert.deepEqual(jobs[0].rows.map((r) => r.project), ['citadel-workspaces', 'integration-tests']);
  assert.deepEqual(jobs[1].rows.map((r) => r.gate.run), ['npm run check:chat-polish', 'npm run check:ui-sweep']);
  assert.deepEqual(matrixRows(['    steps:']), [{}]);
});

test('step conditions: matrix equality decided, failure() never, unknown kept', () => {
  assert.equal(stepRuns("matrix.project == 'a'", { project: 'a' }), true);
  assert.equal(stepRuns("matrix.project == 'a'", { project: 'b' }), false);
  assert.equal(stepRuns("matrix.project != 'a'", { project: 'b' }), true);
  assert.equal(stepRuns('failure()', {}), false);
  assert.equal(stepRuns("github.event_name == 'push'", {}), true);
});

test('workflow env keeps literals; expressions are dropped from gate env', () => {
  assert.deepEqual(workflowEnv(WORKFLOW), { SKIP_WASM_BUILD: '1', TOKEN: '${{ secrets.X }}' });
  const env = gates()[0].env;
  assert.equal(env.SKIP_WASM_BUILD, '1');
  assert.equal('TOKEN' in env, false);
});

test('every gate is derived with the directory CI gives its step', () => {
  const byCommand = new Map(gates().map((g) => [g.argv.join(' '), g]));
  assert.deepEqual([...byCommand.keys()], [
    'npm run check:gates-invoked',
    'node scripts/check-file-length.mjs --strict',
    'node scripts/check-a.mjs',
    'node --test scripts/lib/a.test.mjs',
    'npm run check:chat-polish',
    'npm run build',
    'npm run check:bundle',
    'npm run check:ui-sweep',
  ]);
  assert.equal(byCommand.get('npm run check:gates-invoked').cwd, '/root/citadel-workspaces');
  assert.equal(byCommand.get('node scripts/check-file-length.mjs --strict').cwd, '/root');
  assert.equal(byCommand.get('npm run check:chat-polish').env.POLISH_ENGINES, 'chromium');
  assert.equal(byCommand.get('npm run build').prerequisite, true);
});

test('the gate step runs once per matrix row it applies to, deduplicated', () => {
  const lengthGates = gates().filter((g) => g.argv[1] === 'scripts/check-file-length.mjs');
  assert.equal(lengthGates.length, 1);
  assert.deepEqual(lengthGates[0].sources, ['ui:lint', 'ui:lint']);
});

test('a job that installs a browser makes its gates heavy; a plain job does not', () => {
  const heavy = new Map(gates().map((g) => [g.argv.join(' '), g.heavy]));
  assert.equal(heavy.get('npm run check:chat-polish'), true);
  assert.equal(heavy.get('npm run check:gates-invoked'), false);
});

test('a working directory outside the mapped checkout fails loudly', () => {
  const text = WORKFLOW.replace('working-directory: parent/citadel-workspaces\n      - name: Root', 'working-directory: elsewhere\n      - name: Root');
  assert.throws(() => deriveGates({ text, source: 'ui', resolveDir, seen: new Map() }), /outside: elsewhere/);
});

test('an unexpanded expression in a gate command is an error, not a skipped gate', () => {
  assert.throws(() => gateChains('npm run check:${{ matrix.missing }}'), /unexpanded/);
  assert.throws(() => gateChains('node scripts/x.mjs | tee log'), /needs a shell/);
});

test('a prerequisite only counts when a gate follows it', () => {
  assert.deepEqual(gateChains('npm run build'), []);
  assert.deepEqual(gateChains('npm run build && npm run check:bundle'), [[['npm', 'run', 'build'], ['npm', 'run', 'check:bundle']]]);
  assert.deepEqual(argv(`node scripts/x.mjs --name 'a b'`), ['node', 'scripts/x.mjs', '--name', 'a b']);
});

test('the Node requirement is the major covering the most gates, with the rest reported', () => {
  const g = (label, majors) => ({ label, nodeMajors: new Set(majors) });
  const r = nodeRequirement([g('a', [20]), g('b', [20, 22]), g('e', [20]), g('c', [22]), g('d', [])]);
  assert.equal(r.major, 20);
  assert.deepEqual(r.elsewhere, [{ label: 'c', majors: [22] }]);
  assert.throws(() => nodeRequirement([g('d', [])]), /pins a Node version/);
  assert.throws(() => nodeRequirement([g('a', [20]), g('c', [22])]), /evenly/);
});
