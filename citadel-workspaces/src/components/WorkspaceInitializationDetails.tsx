/**
 * The explanatory panel inside the initialization prompt.
 *
 * Split out so the modal keeps its form and submit handling. This is copy and
 * derived identity fields — the part that grew when the prompt was made honest
 * about what it is asking for.
 */

import { dialledHost } from '@/lib/sessions/same-server';
import { AlertCircle } from 'lucide-react';

interface Props {
  workspaceName?: string;
  workspaceId?: string;
  serverAddress?: string;
  username?: string;
  fullName?: string;
}

export function WorkspaceInitializationDetails({
  workspaceName,
  workspaceId,
  serverAddress,
  username,
  fullName,
}: Props): JSX.Element {
  return (
                        <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-start gap-2">
                            <AlertCircle className="h-5 w-5 text-warning-emphasis flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-warning-emphasis">
                                <p className="font-semibold">You will become the Workspace Administrator</p>
                                <p className="mt-1">By entering the workspace password, you will initialize this workspace and receive full administrator privileges including the ability to:</p>
                                <ul className="mt-2 list-disc list-inside text-xs space-y-1">
                                    <li>Create and manage offices and rooms</li>
                                    <li>Add and remove users</li>
                                    <li>Grant permissions to other users</li>
                                    <li>Configure workspace settings</li>
                                </ul>
                                {(workspaceName || workspaceId || serverAddress || username) && (
                                    <div className="mt-3 pt-2 border-t border-warning/30 space-y-1 text-xs">
                                        {/* Name first. The precedence was inverted, and the
                                            caller always passes an id, so the single most
                                            consequential first-run dialog on a production
                                            deployment read "Workspace: root" and never showed the
                                            human name at all. */}
                                        {(workspaceName || workspaceId) && (
                                            <p><span className="text-warning-emphasis">Workspace:</span> {workspaceName || workspaceId}</p>
                                        )}
                                        {serverAddress && <p><span className="text-warning-emphasis">Server:</span> {dialledHost(serverAddress)}</p>}
                                        {(fullName || username) && (
                                            <p><span className="text-warning-emphasis">User:</span> {fullName && username && fullName !== username ? `${fullName} (${username})` : (username || fullName)}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
  );
}
