/**
 * The best-practices shortfall CI is allowed, and only when it is exactly this.
 *
 * Lighthouse audits the bundle with no agent behind the `/ws` proxy, so two
 * audits fail every run and best-practices lands on 93 against a 95 floor,
 * permanently:
 *
 *   errors-in-console  the WASM client cannot open its socket, reported once
 *                      per layer as the failure propagates. Not an artificial
 *                      state: the deployed UI never proxies the agent, so this
 *                      is what someone sees before starting their own, and the
 *                      app handles it with a Connection Failed dialog.
 *   valid-source-maps  Lighthouse FETCHES each map, so on a loaded runner it
 *                      reports "missing" against a build whose maps are
 *                      correct — it appears in some CI runs and not others.
 *                      check-source-maps.mjs asks the same question of the
 *                      files on disk, where the answer cannot flicker, and
 *                      that is the gate that actually guards this.
 *   inspector-issues   cbor-x probes for `new Function` inside a try/catch and
 *                      falls back to its interpreted path when the policy
 *                      refuses. Chrome logs the refusal anyway. Allowing
 *                      'unsafe-eval' to silence it would trade a real security
 *                      boundary for a quieter report.
 *
 * Neither is a regression signal, and a gate that can never pass is one people
 * learn to re-run without reading. Lowering the floor to 93 would have hidden
 * the next real best-practices problem too, so the shortfall is accepted only
 * when EVERY failing audit is one of these two AND its contents are what we
 * expect. A third audit, a console error that is not the absent agent, or an
 * inspector issue that is not the policy, still fails the build.
 *
 * Accepting CSP issues here is not a hole: check-production-image.mjs gates
 * them precisely against the real nginx policy, failing on every violation
 * type except the eval probe. That is the authority for CSP, not this.
 */
// Two spellings of the same failure. The app reports "WebSocket connection
// failed"; the BROWSER reports "WebSocket connection to 'ws://…/ws' failed:
// Connection closed before receiving a handshake response", which the first
// pattern does not match — that one extra error is what kept the gate red, and
// it stayed invisible while the printout truncated each audit to three items.
// Still specific: it requires a websocket connection that failed, so a
// TypeError or an application error is not swept up.
// The third alternative used to be a bare `WorkspaceClient`, which excused ANY
// console error that happened to name the class -- including a genuine
// application bug thrown from inside it, which is exactly what this gate is
// supposed to notice. Narrowed to the initialisation failure that follows from
// the WASM client having no agent to talk to, which is the condition being
// excused.
const EXPECTED_CONSOLE_ERROR =
  /WebSocket connection\b.*\bfailed|Failed to initialize WASM client|Error initializing WorkspaceClient/i;

export function explainShortfall(category, audits) {
  const failing = (category.auditRefs ?? [])
    .map((ref) => audits[ref.id])
    .filter((a) => a && a.score !== null && a.score < 1);
  if (failing.length === 0) return { expected: false, reason: 'nothing is failing' };
  const KNOWN = new Set(['errors-in-console', 'inspector-issues', 'valid-source-maps']);
  const unknown = failing.filter((a) => !KNOWN.has(a.id)).map((a) => a.id);
  if (unknown.length) return { expected: false, reason: `unrecognised audit(s): ${unknown.join(', ')}` };

  for (const audit of failing) {
    const items = audit.details?.items ?? [];
    // An audit that fails while telling us nothing cannot be recognised, so it
    // is not excused.
    if (items.length === 0) {
      return { expected: false, reason: `${audit.id} failed but listed nothing to identify it by` };
    }

    if (audit.id === 'valid-source-maps') {
      // Only ever excused for our own assets. A third-party script without a
      // map is a different conversation, and check-source-maps.mjs is what
      // proves ours are really there.
      const foreign = items
        .map((i) => String(i.scriptUrl ?? i.url ?? ''))
        .filter((u) => !/^\/|localhost/.test(u));
      if (foreign.length) {
        return { expected: false, reason: `source maps missing for non-local script(s): ${foreign.join(', ')}` };
      }
    } else if (audit.id === 'errors-in-console') {
      const messages = items.map((i) => String(i.description ?? i.errorMessage ?? ''));
      const unexpected = messages.filter((m) => !EXPECTED_CONSOLE_ERROR.test(m));
      if (unexpected.length) {
        return {
          expected: false,
          reason: `${unexpected.length} of ${messages.length} console error(s) are not the absent agent: ` +
            unexpected.map((m) => m.slice(0, 160)).join(' | '),
        };
      }
    } else {
      const other = items
        .map((i) => String(i.issueType ?? ''))
        .filter((t) => !/content security policy/i.test(t));
      if (other.length) {
        return { expected: false, reason: `inspector issue(s) that are not the policy: ${other.join(', ')}` };
      }
    }
  }
  return { expected: true, reason: failing.map((a) => a.id).join(' + ') };
}

