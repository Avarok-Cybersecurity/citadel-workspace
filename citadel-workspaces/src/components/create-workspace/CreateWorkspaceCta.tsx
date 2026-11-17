import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { canCreateWorkspaces } from '@/lib/onboarding/control-plane-config';

/**
 * "New to Citadel? Create a workspace" on the landing page, where this
 * deployment can create one.
 *
 * Not behind the agent, deliberately. Both buttons above it need the local
 * agent and, on the hosted site, a first-time visitor has not installed one --
 * so without this the one thing such a visitor can do without it, set up a
 * workspace, was reachable only through a dialog that waits for the agent.
 * The create flow needs only the control plane, and offers the agent download
 * at the point it becomes necessary.
 */
export function CreateWorkspaceCta(): JSX.Element | null {
  if (!canCreateWorkspaces(typeof document === 'undefined' ? undefined : document)) return null;
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      New to Citadel?{' '}
      <Link
        to="/create"
        data-testid="create-workspace-link"
        className="inline-flex min-h-[24px] items-center font-medium text-foreground underline underline-offset-4"
      >
        Create a new workspace
      </Link>
    </p>
  );
}
