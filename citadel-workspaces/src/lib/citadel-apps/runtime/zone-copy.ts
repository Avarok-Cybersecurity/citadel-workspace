/**
 * What a zone says when its app is not running: the host's words for each step that refused, and
 * for each way an instance stops. Never the app's own text, and never more about why than the
 * person can act on.
 */
import type { InstanceState } from '../host/instance';
import type { ReleaseFailure } from './release-loader';

export function failureCopy(name: string, failure: ReleaseFailure): string {
  switch (failure.step) {
    case 'release': return `${name}’s release could not be read from the workspace server, so it was not started.`;
    case 'artifact': return `${name}’s code could not be fetched from the workspace server, so it was not started.`;
    case 'manifest': return `${name}’s manifest does not read, so it was not started.`;
    case 'abi': return `${name} is not built for this version of Citadel, so it was not started.`;
    case 'signature-text': return `${name} did not pass its signature check, so it was not started.`;
    case 'integrity':
      return failure.refusal === 'verifier_failed'
        ? `${name} could not be checked on this device, so it was not started.`
        : `${name} did not pass its signature and hash check, so it was not started.`;
  }
}

/** Null while it runs (or before it has), and once it was closed or ended by the host on purpose. */
export function stoppedCopy(name: string, state: InstanceState): string | null {
  switch (state) {
    case 'init-failed': return `${name} could not start.`;
    case 'stopped-trapped': return `${name} stopped because of an error.`;
    case 'stopped-unresponsive': return `${name} stopped responding and was closed.`;
    case 'loading': case 'running': case 'terminated': case 'closed': return null;
  }
}
