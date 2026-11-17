import { LegalLinks } from '@/components/terms/LegalLinks';
import { useNavigate } from "react-router-dom";
import { useRegistrationChoices, type RegistrationChoices } from "@/components/registration-choices";
import { LazyLandingSteps as LandingSteps } from "./lazy-landing-steps";
import { Button } from "@/components/ui/button";
import { LogIn, Settings, Shield, ArrowRight } from "lucide-react";
import { useState, useCallback } from "react";
import { postAuthSetup } from '@/lib/post-auth-setup';
import { ManageAccountsButton } from "@/components/ManageAccountsButton";
import { OrphanSessionsNavbar } from "@/components/OrphanSessionsNavbar";
import { cn } from "@/lib/utils";
import { getWorkspacePath } from "@/lib/workspace-navigation";
import { debugLog } from '@/lib/debug-config';
import { useToast } from '@/hooks/use-toast';
import { toastError } from '@/lib/toast-helpers';
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import type { NavigateFunction } from 'react-router';
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { OnboardingIntent } from '@/components/onboarding/OnboardingIntent';
import { useOnboardingIntent } from '@/hooks/useOnboardingIntent';
import { useAgentGatedStep } from '@/hooks/use-agent-gate';
import type { OnboardingIntentState } from '@/hooks/useOnboardingIntent';
import { CreateWorkspaceCta } from '@/components/create-workspace/CreateWorkspaceCta';
import { useLinkedLogin } from './use-account-link';
import { usePendingRedirectSignIn } from './use-pending-redirect-sign-in';
import { resolvePendingRedirect } from '@/lib/share/resolve-here';
import { useJoinLink } from './use-join-link';
import { useHasOrphanSessions } from './use-orphan-sessions';
import { LazySettingsModal } from '@/components/LazySettingsModal';
import { SignedOutNotice } from '@/components/signed-out/SignedOutNotice';

export const Landing: () => JSX.Element = (): JSX.Element => {
  const navigate: NavigateFunction = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<'none' | 'server' | 'security' | 'join' | 'login'>('none');
  // The security chosen and the profile typed; see SecurityAndProfileSteps.
  const choices: RegistrationChoices = useRegistrationChoices();
  const clearProfileDraft: () => void = choices.clearProfileDraft;
  const hasOrphanSessions: boolean = useHasOrphanSessions();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Server connection data lifted to Landing state to avoid React Query GC eviction
  const [serverAddress, setServerAddress] = useState('');
  const [serverPassword, setServerPassword] = useState('');

  useJoinLink(useCallback((): void => setCurrentStep('server'), []), setServerAddress, currentStep !== 'none' && currentStep !== 'login');

  // The landing page used to call `listKnownServers({ cid: "0" })` here on
  // mount and DISCARD the result. `checkForServers` checked nothing: nothing
  // read what it returned, and nothing rendered from it.
  //
  // It was not free. That request is `LocalDBGetAllKV`, which has no
  // key-listing form -- it returns every key's VALUE in bucket 0, shared across
  // every account on the device: every message page, every document snapshot,
  // the session list. On a few accounts with some history that is megabytes,
  // materialised at the WASM boundary as one boxed JS array element per byte,
  // on first paint, before the user has done anything.
  //
  // `Connect.tsx` is where the known-server list is actually read, and it asks
  // for it there.

  const handleServerNext = (address: string, password: string): void => {
    setServerAddress(address);
    setServerPassword(password);
    setCurrentStep('security');
  };
  const handleSecurityBack = (): void => setCurrentStep('server');
  // Both success paths: set the session up, then open the secure link the visitor came with, if any.
  const finishAuth: (failTitle: string, failDetail: string) => (cid: string) => Promise<void> = (failTitle: string, failDetail: string) => async (cid: string): Promise<void> => {
    debugLog('Landing', `[Landing] signed in with cid: ${cid}`);
    try {
      await postAuthSetup(BigInt(cid));
      await resolvePendingRedirect(navigate, getWorkspacePath());
    } catch (error) {
      debugLog('Landing', `${failTitle}:`, error);
      toastError(toast, failTitle, error instanceof Error ? error.message : failDetail);
    }
  };
  const handleJoinNext: (cid: string) => Promise<void> = finishAuth("Setup Failed", "Failed to load workspace after registration");
  const handleJoinBack = (): void => setCurrentStep('security');
  const beginWizard: () => void = useCallback((): void => {
    clearProfileDraft();
    // Allow joining new workspaces regardless of existing sessions (Slack-like multi-workspace)
    setCurrentStep('server');
  }, [clearProfileDraft]);

  // Production only: ask which job the user is here to do before the wizard,
  // so the master password is named before it is needed rather than after.
  const intent: OnboardingIntentState = useOnboardingIntent(beginWizard, navigate);
  const startRegistration: () => void = intent.request;

  // Both buttons on this screen need the agent; see use-agent-gate.ts.
  const startLogin: () => void = useAgentGatedStep(setCurrentStep, 'login', 'none');
  const { linkedUsername, linkedServer, startPlainLogin } = useLinkedLogin(startLogin, currentStep === 'login');
  const handleLoginNext: (cid: string) => Promise<void> = finishAuth("Login Setup Failed", "Failed to load workspace after login");
  // A secure link opened signed out: sign-in first, its server ready for a join.
  usePendingRedirectSignIn(startLogin, setServerAddress);

  return (
    <div className="h-dvh flex items-center relative overflow-hidden bg-background">
      {/* Orphan sessions navbar */}
      <OrphanSessionsNavbar />

      {/* Solid background base */}
      <div className="absolute inset-0 z-0 bg-background fixed" />

      {/* Subtle dot grid pattern */}
      <div
        className="absolute inset-0 z-[0] fixed pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Subtle radial gradient accent */}
      <div
        className="absolute inset-0 z-[0] fixed pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 70% 50%, hsl(var(--primary) / 0.06) 0%, transparent 70%)',
        }}
      />

      {/* Background Image with proper positioning */}
      <div
        className="absolute inset-0 z-[1] bg-center bg-no-repeat bg-cover md:bg-contain w-full h-full fixed md:bg-right"
        style={{
          backgroundImage: "url('/backgrounds/landing-hero.webp')",
        }}
      />

      {/* Scrim between the hero image and the copy. The gradient direction is
          responsive (vertical when stacked, horizontal side-by-side), which a
          media query has to express — see .landing-scrim in index.css. */}
      <div className="absolute inset-0 z-[2] fixed pointer-events-none landing-scrim" />

      {/* Content. <main>, not <div>: axe flags the heading and CTA block as
          "content not contained by landmarks". Only this region becomes the
          landmark — the orphan-sessions navbar above and the decorative
          background layers are deliberately outside it, since a landmark that
          swallows the navigation is no more useful than none. */}
      <main className={cn(
        "container mx-auto px-6 sm:px-8 lg:px-12 py-10 md:py-0 relative z-10",
        hasOrphanSessions && "pt-24"
      )}>
        <div className="max-w-xl lg:max-w-2xl animate-fade-in">
          {/* Brand tag */}
          {/* The horizontal lockup, the kit's default: 248px wide, over its 120px floor. */}
          <CitadelLogo variant="horizontal" height={36} className="mb-3" />

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6 leading-[1.1] tracking-tight">
            The World's First
            <br />
            <span className="bg-gradient-to-r from-primary-accent to-primary-accent/70 bg-clip-text text-transparent">Post-Quantum</span>
            <br />
            Virtual Workspace
          </h1>

          <p className="text-lg text-muted-foreground mb-10 max-w-md leading-relaxed">
            Hyper-security and control over defense and privacy at your fingertips
          </p>

          {/* CTA Buttons */}
          <OnboardingIntent open={intent.open} onChoose={intent.resolve} onDismiss={intent.resolve} />

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={startPlainLogin}
              data-testid="sign-in-button"
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium px-6 h-11 transition-all duration-200 w-full sm:w-auto flex items-center gap-2 rounded-lg shadow-lg shadow-primary-accent/20 hover:shadow-primary-accent/30"
              size="lg"
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </Button>

            <Button
              onClick={startRegistration}
              data-testid="create-account-button"
              variant="outline"
              className="border-surface text-foreground/80 hover:bg-card hover:text-foreground hover:border-primary-accent/50 text-sm font-medium px-6 h-11 transition-all duration-200 w-full sm:w-auto flex items-center gap-2 rounded-lg"
              size="lg"
            >
              Create Account
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>

          <CreateWorkspaceCta />
          <SignedOutNotice />
          <div className="mt-6 flex items-center gap-4">
            <ManageAccountsButton />
            <div className="w-[1px] h-4 bg-border" />
            <Button
              variant="ghost"
              size="sm"
              // min-h-[24px] is the WCAG 2.2 target-size floor, in CSS px: the root font size is a
              // user setting (14px by default), so a rem-based min-h-6 measured 21px. `h-auto`
              // collapsed this to its 16px text, which is a hard thing to hit
              // with a thumb — and axe does not measure target size, so nothing
              // reported it.
              className="gap-2 text-muted-foreground hover:text-foreground/80 hover:bg-transparent px-0 min-h-[24px] text-xs"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </Button>
            {/* Renders only when the browser has actually offered an install
                prompt and we are not already running installed — see usePwaInstall. */}
            <InstallAppButton className="gap-2 text-muted-foreground hover:text-foreground/80 text-xs inline-flex items-center min-h-[24px]" />
          </div>

          {/* Security badge */}
          <div className="mt-12 flex items-center gap-3 px-4 py-3 rounded-lg bg-primary-accent/5 border border-primary-accent/10 max-w-md">
            <Shield className="w-5 h-5 text-primary-accent flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Citadel uses <span className="text-primary-accent font-medium">lattice-based cryptography</span>. All connections are end-to-end encrypted and resistant to quantum compute attacks.
            </p>
          </div>
          <LegalLinks className="mt-6 max-w-md" />
        </div>
      </main>

      <LandingSteps
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
        serverAddress={serverAddress}
        serverPassword={serverPassword}
        choices={choices}
        handleServerNext={handleServerNext}
        handleSecurityBack={handleSecurityBack}
        handleJoinNext={handleJoinNext}
        handleJoinBack={handleJoinBack}
        handleLoginNext={handleLoginNext}
        loginUsername={linkedUsername}
        loginScope={linkedServer}
      />

      {/* Settings modal */}
      <LazySettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} tab="general" />
    </div>
  );
};

export default Landing;
