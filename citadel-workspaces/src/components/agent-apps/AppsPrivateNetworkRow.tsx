import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export const LAN_GRANT_COPY: {
  readonly label: string;
  readonly description: string;
  readonly signedOut: string;
} = {
  label: 'Let apps reach my private network from this computer',
  description: "Apps you run make their network requests through this agent. When this is on, apps' fetches from this machine may reach your LAN or private network: printers, a NAS, company servers, this computer's own services. Only apps the workspace approved for net.host.private, and only for your account. Off, every such request is refused; public hosts are unaffected.",
  signedOut: 'Sign in to change this for your account',
};

export interface AppsPrivateNetworkRowProps {
  /** Off until the member turns it on; null while the agent has not said. */
  checked: boolean | null;
  /** Whether this window has a session to change it for. */
  signedIn: boolean;
  onChange: (on: boolean) => void;
  error: string | null;
}

/** This member's own grant, on this agent, for every app it runs for them. */
export function AppsPrivateNetworkRow({ checked, signedIn, onChange, error }: AppsPrivateNetworkRowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor="agent-apps-lan-grant" className="text-sm font-medium">{LAN_GRANT_COPY.label}</Label>
        <p id="agent-apps-lan-grant-description" className="text-sm text-muted-foreground">
          {signedIn ? LAN_GRANT_COPY.description : LAN_GRANT_COPY.signedOut}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <Switch id="agent-apps-lan-grant" aria-describedby="agent-apps-lan-grant-description"
        data-testid="agent-apps-lan-grant" disabled={!signedIn || checked === null}
        checked={checked === true} onCheckedChange={onChange} />
    </div>
  );
}
