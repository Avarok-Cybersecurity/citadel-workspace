import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { NavigateFunction } from 'react-router';

interface WorkspaceNotInitializedModalProps {
    isOpen: boolean;
    onReturnToLogin: () => void;
}

export const WorkspaceNotInitializedModal: React.FC<WorkspaceNotInitializedModalProps> = ({
    isOpen,
    onReturnToLogin
}) => {
    const navigate: NavigateFunction = useNavigate();

    const handleReturnToLogin = (): void => {
        onReturnToLogin();
        navigate('/');
    };

    // Above the early return: hooks must run in the same order every render.
    const { ref: dialogRef, dialogProps } = useDialogOverlay({
        label: 'Workspace not initialized',
        enabled: isOpen,
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" ref={dialogRef} {...dialogProps}>
            <Card className="bg-card border-surface shadow-lg w-full max-w-md">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <AlertCircle className="h-6 w-6 text-warning-emphasis" />
                        <div>
                            <CardTitle className="text-foreground text-xl">Workspace Not Initialized</CardTitle>
                            <CardDescription className="text-foreground/80">
                                Setup required before you can register
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                        <p className="text-warning-emphasis text-sm">
                            This workspace has not been initialized yet. Please contact your workspace administrator to complete the initial setup.
                        </p>
                    </div>

                    <div className="space-y-2 text-foreground/80 text-sm">
                        <p>The administrator needs to:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2">
                            <li>Log in with their admin credentials</li>
                            <li>Set up the workspace name and description</li>
                            <li>Configure the workspace master password</li>
                        </ul>
                    </div>

                    <div className="bg-primary-accent/10 border border-primary-accent/30 rounded-lg p-3">
                        <p className="text-primary-accent text-xs">
                            Once the workspace is initialized, you'll be able to register and join the workspace.
                        </p>
                    </div>
                </CardContent>

                <CardFooter>
                    <Button
                        onClick={handleReturnToLogin}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Return to Login
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};