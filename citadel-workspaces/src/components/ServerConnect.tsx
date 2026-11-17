import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { useDialogOverlay } from '@/hooks/use-dialog-overlay';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Globe, Lock, Shield, ArrowRight } from "lucide-react";
import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { RegistrationStepIndicator } from "./RegistrationStepIndicator";
import { readDefaultWorkspaceServer } from "@/lib/default-workspace-server";
import { normalizeWorkspaceAddress } from "@/lib/workspace-address";
import { createdWorkspaceAddress } from "@/lib/onboarding/claim-handoff";

interface ServerConnectProps {
  onNext: (address: string, password: string) => void;
  /**
   * Required, with no navigation fallback.
   *
   * It was optional, and both Escape and Cancel fell back to `navigate('/')`.
   * WorkspaceSwitcher renders this inside a Radix Dialog without passing it, so
   * pressing Escape — the standard way to close a dialog — closed the dialog AND
   * threw the user out of their workspace to the Landing page. Making it
   * required means a caller has to say what dismissing means to them.
   */
  onCancel: () => void;
  defaultServer?: string;
  title?: string;
  initialAddress?: string;
  initialPassword?: string;
}

export const ServerConnect = ({ onNext, onCancel, defaultServer, title, initialAddress, initialPassword }: ServerConnectProps): JSX.Element => {
  const { toast } = useToast();

  // Precedence: an address this flow was given, then whatever the user already
  // typed, then the server THIS deployment publishes. The last one is why a
  // visitor arriving at a hosted page cold is not asked for an address nobody
  // ever told them -- the page and the server are different hosts, so it cannot
  // be derived from window.location. Empty stays empty for a local build.
  //
  // A workspace this page has just created comes before the published default:
  // the visitor pressed "Open your workspace" on it, and it is the one they mean.
  //
  // A pre-fill, never a lock: the field remains editable, because reaching
  // someone else's server from this page is a legitimate thing to do.
  const publishedDefault: string | undefined =
    typeof document === 'undefined' ? undefined : readDefaultWorkspaceServer(document);
  const justCreated: string | undefined = createdWorkspaceAddress();
  const [serverAddress, setServerAddress] = useState(
    defaultServer || initialAddress || justCreated || publishedDefault || '',
  );
  const [password, setPassword] = useState(initialPassword || '');

  const handleConnect = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!serverAddress) {
      toast({
        title: "Server address required",
        description: "Please enter a server address to connect",
        variant: "destructive",
      });
      return;
    }

    // Basic server address validation — must look like a hostname or IP
    const trimmed: string = serverAddress.trim();
    if (!trimmed.includes('.') && !trimmed.includes(':')) {
      toast({
        title: "Invalid server address",
        description: "Please enter a valid server address (e.g., workspace.avarok.net or 127.0.0.1:8080)",
        variant: "destructive",
      });
      return;
    }

    // The port is assumed here, once, so every consumer downstream -- register,
    // login, the stored session list -- sees the same `host:port` the agent
    // dials. Doing it further down would leave each of them to remember.
    onNext(normalizeWorkspaceAddress(serverAddress), password);
  };

  const { ref: dialogRef, dialogProps } = useDialogOverlay({ label: 'Connect to a server', onDismiss: onCancel });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" ref={dialogRef} {...dialogProps}>
      <div className="w-full max-w-md">
        <Card className="bg-background border-border shadow-2xl shadow-black/40">
          <CardHeader className="pb-4">
            {/* Mark only: the card is narrow and the wordmark has a 130px floor. */}
            <CitadelLogo variant="mark" height={34} className="mb-4" />
            <RegistrationStepIndicator currentStep={1} />
            <h2 className="text-xl font-bold text-foreground mt-5">{title || "Create Account"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {defaultServer ? "Connect with a different account" : "Enter workspace details to get started"}
            </p>
          </CardHeader>

          <form onSubmit={handleConnect}>
            <CardContent className="space-y-5 max-h-[calc(100dvh-16rem)] overflow-y-auto">
              {/* Workspace Address */}
              <div className="space-y-2">
                <label htmlFor="serverAddress" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Workspace Address
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="serverAddress"
                    data-testid="server-address-input"
                    value={serverAddress}
                    onChange={(e) => setServerAddress(e.target.value)}
                    className="bg-input border-border text-foreground pl-10 h-11 rounded-lg placeholder:text-muted-foreground focus:border-primary-accent focus:ring-1 focus:ring-ring/30 transition-all"
                    // Without a port, because one is no longer required: see
                    // lib/workspace-address.ts, which assumes DEFAULT_WORKSPACE_PORT
                    // when none is typed. The placeholder shows the simplest thing
                    // that works, and a user who needs another port still types it.
                    placeholder="citadel.example.com"
                  />
                </div>
              </div>

              {/* The connection's pre-shared key. Not the claim code or master password, which
                  new owners were told they would need and pasted here: see server-password-error. */}
              <div className="space-y-2">
                <label htmlFor="password" className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                  Server Password (Optional)
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-input border-border text-foreground pl-10 h-11 rounded-lg placeholder:text-muted-foreground focus:border-primary-accent focus:ring-1 focus:ring-ring/30 transition-all"
                    placeholder="••••••••••••"
                    aria-describedby="server-password-hint"
                  />
                </div>
                <p id="server-password-hint" className="text-xs text-muted-foreground">
                  Leave blank unless the server&rsquo;s operator gave you one. A claim code or master password is asked for after you join.
                </p>
              </div>

              {/* Security info banner */}
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-primary-accent/5 border border-primary-accent/10">
                <Shield className="w-4 h-4 text-primary-accent flex-shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Citadel uses <span className="text-primary-accent">lattice-based cryptography</span>. All connections are
                  end-to-end encrypted and resistant to quantum compute attacks.
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                className="text-muted-foreground hover:text-foreground hover:bg-transparent"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="wizard-next"
                className="bg-primary hover:bg-primary/90 text-primary-foreground transition-all gap-2 px-5 rounded-lg shadow-lg shadow-primary-accent/20"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
};
