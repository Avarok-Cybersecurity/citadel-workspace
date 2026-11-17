import type { JSX } from 'react';

/**
 * What the initialization prompt is actually asking for, in words.
 *
 * A separate component because WorkspaceInitializationModal is at the 250-line
 * cap and this is prose, not logic -- but also because this text is the fix. The
 * modal is a correct, working mechanism that a real deployment's owner could not
 * get through, and the reason was never the code:
 *
 *   - The field said "Workspace Password" with the placeholder "Enter the
 *     workspace password". The product has THREE different passwords in the
 *     first five minutes -- the account password the user picks in the join
 *     wizard, the optional server password on the connect step (ServerConnect
 *     labelled that one "Workspace Password (Optional)", the same two words;
 *     it is now "Server Password"), and this one. Nothing anywhere said which.
 *   - The helper text said "Contact your workspace administrator if you don't
 *     have the password", and on a brand-new deployment there IS no
 *     administrator. This prompt is how the first one comes to exist. It sent
 *     the only person who could complete it to ask somebody who does not exist.
 *
 * So this names the variable (`WORKSPACE_MASTER_PASSWORD`) and where an operator
 * put it, distinguishes it from the password the user chose minutes earlier, and
 * says plainly what happens to somebody who does not have it -- because that is
 * most people who see this dialog, and the honest answer is that they can walk
 * away from it and keep working.
 *
 * The variable NAME, never a value. Nothing on this screen may echo, log or
 * pre-fill the secret itself.
 */
export function WorkspaceInitializationGuidance(): JSX.Element {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Created this workspace at work.avarok.net?</span>{' '}
        Enter the <span className="font-medium text-foreground">claim code</span> you were shown
        when you created it. It makes you the workspace&rsquo;s owner.
      </p>
      <p>
        Running your own server? This asks for the{' '}
        <span className="font-medium text-foreground">workspace master password</span> — not
        the account password you chose when you registered. It is a separate secret, set by
        whoever deployed this server as{' '}
        <code className="font-mono text-xs text-foreground">WORKSPACE_MASTER_PASSWORD</code> in
        the server&rsquo;s environment, usually a <code className="font-mono text-xs">.env</code>{' '}
        file beside it.
      </p>
      <p>
        If you deployed this server, that is where to look. If you did not, the person who did
        holds it — ask them, or choose{' '}
        <span className="font-medium text-foreground">Not now</span>. The workspace already
        works without this, and whoever has the password can finish the step later.
      </p>
    </div>
  );
}
