import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import React, { useState } from "react";
import { WorkspaceInitializationDetails } from './WorkspaceInitializationDetails';
import { WorkspaceInitializationGuidance } from './WorkspaceInitializationGuidance';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import WorkspaceService from "@/lib/workspace-service";
import { WorkspaceProtocolRequestTS, WorkspaceProtocolPayloadTS } from "@/types/workspace-protocol";
import { getUserFriendlyErrorMessage, getErrorTitle } from "@/lib/error-messages";
import { workspaceEvents } from "@/lib/workspace-events";
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import type { WorkspaceInitializationModalProps } from './workspace-init-types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { forgetIssuedClaim } from '@/lib/onboarding/claim-handoff';
import { useClaimCodePrefill } from '@/lib/onboarding/use-claim-code-prefill';

export const WorkspaceInitializationModal: React.FC<WorkspaceInitializationModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    workspaceName,
    workspaceId,
    serverAddress,
    username,
    fullName
}) => {
    const [masterPassword, setMasterPassword] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const prefilled: boolean = useClaimCodePrefill(isOpen, serverAddress, setMasterPassword);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setMasterPassword(e.target.value);
        setError(null);
    };

    const validateForm = (): boolean => {
        if (!masterPassword) {
            setError("Enter the workspace master password, or choose Not now.");
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();

        if (!validateForm()) {
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const metadata: { initialized: boolean; } = { initialized: true };
            const metadataBytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(JSON.stringify(metadata));
            const metadataArray: number[] = Array.from(metadataBytes);

            const request: WorkspaceProtocolRequestTS = {
                UpdateWorkspace: {
                    workspace_master_password: masterPassword,
                    name: undefined,
                    description: undefined,
                    metadata: metadataArray
                }
            };

            const payload: WorkspaceProtocolPayloadTS = { Request: request };

            const responsePromise: Promise<void> = new Promise<void>((resolve, reject) => {
                let unsubscribeWorkspace: (() => void) | null = null;
                let unsubscribeError: (() => void) | null = null;
                let timeoutId: NodeJS.Timeout | null = null;

                const cleanup = (): void => {
                    if (unsubscribeWorkspace) unsubscribeWorkspace();
                    if (unsubscribeError) unsubscribeError();
                    if (timeoutId) clearTimeout(timeoutId);
                };

                runAsyncSetup(async () => {
                    unsubscribeWorkspace = await workspaceEvents.onWorkspaceEvent('workspace:loaded', () => {
                        cleanup();
                        resolve();
                    });
                });

                runAsyncSetup(async () => {
                    unsubscribeError = await workspaceEvents.onOperationEvent('operation:error', (error) => {
                        cleanup();
                        reject(new Error(error.message || 'Failed to initialize workspace'));
                    });
                });

                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error('Request timed out'));
                }, 10000);
            });

            await WorkspaceService.sendWorkspaceRequest(payload);
            await responsePromise;

            try {
                if (username) {
                    await WorkspaceService.getUserPermissions(username, WORKSPACE_ROOT_ID);
                    debugLog('WorkspaceInitializationModal', 'User permissions loaded after workspace initialization for:', username);
                } else {
                    debugLog('WorkspaceInitializationModal', 'No username available to load permissions');
                }
            } catch (permErr) {
                debugLog('WorkspaceInitializationModal', 'Failed to load user permissions after initialization:', permErr);
            }

            toast({
                title: "Workspace Initialized",
                description: "You are now the workspace administrator.",
            });

            setMasterPassword("");
            forgetIssuedClaim();
            onSuccess();
        } catch (err: unknown) {
            debugLog('WorkspaceInitializationModal', 'Failed to initialize workspace:', err);
            const userFriendlyMessage: string = getUserFriendlyErrorMessage(err);
            setError(userFriendlyMessage);

            toast({
                title: getErrorTitle(err),
                description: userFriendlyMessage,
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Above the early return: hooks must run in the same order every render.
    const { ref: dialogRef, dialogProps } = useDialogOverlay({
        label: 'Initialize workspace',
        enabled: isOpen,
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" ref={dialogRef} {...dialogProps}>
            <Card className="bg-card border-surface shadow-lg w-full max-w-md">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Shield className="h-6 w-6 text-primary-accent" />
                        <div>
                            <CardTitle className="text-foreground text-xl">Initialize Workspace</CardTitle>
                            <CardDescription className="text-foreground/80">
                                Claim it as its first administrator
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-4 max-h-[calc(100dvh-16rem)] overflow-y-auto">
                        {/* Names the secret, says where an operator keeps
                            it, and says what happens to somebody who does not
                            have it. WorkspaceInitializationGuidance carries the
                            reasoning: for this dialog the copy IS the fix. */}
                        <WorkspaceInitializationGuidance />
                        <WorkspaceInitializationDetails
                            workspaceName={workspaceName}
                            workspaceId={workspaceId}
                            serverAddress={serverAddress}
                            username={username}
                            fullName={fullName}
                        />

                        <div className="space-y-2">
                            <Label htmlFor="masterPassword" className="text-foreground/80">
                                Claim code or workspace master password
                            </Label>
                            <Input
                                id="masterPassword"
                                autoComplete="off"
                                name="masterPassword"
                                type="password"
                                value={masterPassword}
                                onChange={handleInputChange}
                                className="bg-surface text-foreground"
                                placeholder="The server's WORKSPACE_MASTER_PASSWORD"
                                disabled={isSubmitting}
                            />
                            {/* NOT "contact your workspace administrator", which
                                is what this said. On a server nobody has claimed
                                there is no administrator to contact — this prompt is
                                how the first one comes to exist. */}
                            <p className="text-xs text-muted-foreground">
                                {prefilled
                                    ? "Filled in with this workspace's claim code."
                                    : "Not the password you chose when you created your account."}
                            </p>
                        </div>

                        {error && (
                            <div data-testid="init-modal-error" role="alert" className="text-destructive-emphasis text-sm p-2 bg-destructive/10 rounded border border-destructive/20 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {error}
                            </div>
                        )}
                    </CardContent>

                    <CardFooter className="flex justify-between">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={onClose}
                            className="text-foreground hover:bg-primary-accent/20"
                            disabled={isSubmitting}
                            data-testid="init-modal-decline"
                        >
                            Not now
                        </Button>
                        <Button
                            type="submit"
                            data-testid="init-modal-submit"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Initializing...
                                </>
                            ) : (
                                "Initialize & Become Admin"
                            )}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
};
