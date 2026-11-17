import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Server, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { listKnownServers, getRecentServers, StoredServer } from "@/lib/server-utils";
import { getWorkspacePath } from "@/lib/workspace-navigation";
import { resolvePendingRedirect } from '@/lib/share/resolve-here';
import { connectToServer } from "./connect/use-connect-to-server";
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import { activateOnKey } from '@/lib/a11y';
import type { NavigateFunction } from 'react-router';
import type { ConnectOutcome } from '@/pages/connect/use-connect-to-server';

export const Connect: () => JSX.Element = (): JSX.Element => {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const [servers, setServers] = useState<StoredServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  // Memoize the fetchServers function to prevent it from being recreated on each render
  const fetchServers: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      // Using "1" as a valid u64 string representation for the connect page
      const response: { servers: StoredServer[]; } = await listKnownServers({ cid: "1" });
      setServers(response.servers);
      if (response.servers.length > 0) {
        setSelectedServer(response.servers[0].serverAddress);
      }
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      debugLog('Connect', 'Error fetching known servers:', error);
      debugLog('Connect', 'Error details:', errorMessage);

      // Fall back to the servers we already have on disk.
      //
      // saveRecentServer writes this list on every successful connect,
      // documented as being "for offline/fallback access" so this page always
      // has data — but nothing ever read it. The one moment it exists for is
      // this one, and until now a user whose protocol call failed was told
      // "Failed to load saved workspaces" while their servers sat in
      // localStorage untouched.
      const cached: StoredServer[] = getRecentServers();
      if (cached.length > 0) {
        setServers(cached);
        setSelectedServer(cached[0].serverAddress);
        toast({
          // Said plainly: this list is from a previous session, so an address
          // that has since changed will not be reflected here.
          title: "Showing saved workspaces",
          description: "Could not reach the service, so these are from your last session.",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to load saved workspaces",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Run the effect only once when the component mounts
  useEffect(() => {
    runAsyncSetup(fetchServers);
  }, [fetchServers]);

  const handleConnect = async (): Promise<void> => {
    if (!selectedServer) {
      toast({
        title: "No Server Selected",
        description: "Please select a server to connect to",
        variant: "destructive",
      });
      return;
    }

    const selectedServerInfo: StoredServer | undefined = servers.find(s => s.serverAddress === selectedServer);
    if (!selectedServerInfo) return;

    try {
      setLoading(true);
      toast({
        title: "Connecting",
        description: `Connecting to ${selectedServer}...`,
      });

      const outcome: ConnectOutcome = await connectToServer(selectedServer);

      if (outcome.kind === 'needs-sign-in') {
        // Do NOT navigate into the workspace. With no session the loader times
        // out after 5s and sends the user straight back here, silently — which
        // is what this page used to do on every attempt.
        toast({
          title: "Sign in again to continue",
          description: `${outcome.reason} Sign in to reconnect.`,
          variant: "destructive",
        });
        navigate('/');
        return;
      }

      await resolvePendingRedirect(navigate, getWorkspacePath());
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      debugLog('Connect', 'Error connecting to server:', error);
      debugLog('Connect', 'Connection error details:', errorMessage);
      toast({
        title: "Connection Failed",
        description: `Failed to connect to ${selectedServer}: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <Card className="w-full max-w-xl bg-card border-surface shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-foreground" />
            {/* h1, not the CardTitle default h3. The route had no h1, and the
                later "Choose a workspace" is an h2 -- so the levels ran
                backwards from 3 to 2 with no page title above either. */}
            <CardTitle as="h1" className="text-foreground text-2xl">Connect to Workspace</CardTitle>
          </div>
          <CardDescription className="text-foreground/80">Select a saved workspace to connect</CardDescription>
        </CardHeader>

        {loading ? (
          <CardContent className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-accent mx-auto"></div>
            <p className="text-foreground mt-4">Loading saved workspaces...</p>
          </CardContent>
        ) : servers.length === 0 ? (
          <CardContent className="text-center py-8">
            <p className="text-foreground mb-4">No saved workspaces found</p>
            <Button
              onClick={() => navigate("/")}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Go Back
            </Button>
          </CardContent>
        ) : (
          <>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {/* A group label, not a field label: it names a list of choices
                  rather than one control, so <label> was the wrong element —
                  it had nothing to be `for`. The list is a radiogroup labelled
                  by this heading. */}
              <h2 id="workspace-choice-label" className="text-sm font-medium text-foreground uppercase">
                Select Workspace
              </h2>
              <div
                role="radiogroup"
                aria-labelledby="workspace-choice-label"
                className="space-y-2 max-h-60 overflow-y-auto pr-2"
              >
                {servers.map((server) => (
                  <div
                    key={server.serverAddress}
                    className={`flex items-center p-3 rounded-md cursor-pointer transition-colors ${selectedServer === server.serverAddress
                      ? "bg-primary/50 border border-primary-accent"
                      : "bg-card/70 hover:bg-card border border-primary-accent/20"
                      }`}
                    onClick={() => setSelectedServer(server.serverAddress)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={activateOnKey((): void => { ((): void => setSelectedServer(server.serverAddress))(); })}
                  >
                    <Server className="w-5 h-5 text-primary-accent mr-3" />
                    <div>
                      <p className="text-foreground font-medium">{server.serverAddress}</p>
                      {server.serverName && (
                        <p className="text-foreground/80 text-sm">{server.serverName}</p>
                      )}
                    </div>
                    {selectedServer === server.serverAddress && (
                      <ArrowRight className="w-5 h-5 text-primary-accent ml-auto" />
                    )}
                  </div>
                ))}
              </div>
            </div>

          </CardContent>
          <CardFooter className="flex justify-end gap-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("/")}
                className="text-foreground hover:bg-primary-accent/20"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConnect}
                className="bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
              >
                Connect
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
};

export default Connect;
