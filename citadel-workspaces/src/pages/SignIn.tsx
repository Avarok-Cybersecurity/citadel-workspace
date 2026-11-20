/**
 * /sign-in: "Sign in with Citadel" (sign-in-with-citadel.md §1-§1a, §8). An app (the
 * synchronized.work site, its MCP) sends the person here with a link; this page proves, through the
 * Citadel Agent on this computer, which identity is signing in, and sends a one-time code back to
 * the app's registered return. Lazy: nothing here is on the landing page's critical path.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { useAgentOptionalHere } from '@/lib/onboarding/agent-optional';
import { describeDevice } from '@/lib/sign-in-with-citadel/describe';
import type { SignInState } from '@/lib/sign-in-with-citadel/flow-state';
import type { SignInFlow } from '@/lib/sign-in-with-citadel/flow';
import type { SignInPorts } from '@/lib/sign-in-with-citadel/ports';
import { ConsentDialog } from '@/components/sign-in-with-citadel/ConsentDialog';
import { ConfirmPhrase, CreateIdentityForm } from '@/components/sign-in-with-citadel/CreateIdentity';
import { Busy, Cancelled, NoAgentScreen, Stopped } from '@/components/sign-in-with-citadel/SignInScreens';
import { browserPorts, useSignInFlow } from '@/components/sign-in-with-citadel/use-sign-in-flow';

function Step({ state, flow, device }: { state: SignInState; flow: SignInFlow; device: string }): JSX.Element {
  switch (state.step) {
    case 'loading': return <Busy label="Checking the sign-in link…" testId="sign-in-loading" />;
    case 'refused': return <Stopped code={state.reason} testId="sign-in-refused" />;
    case 'unavailable': return <Stopped code={state.code} testId="sign-in-unavailable" />;
    case 'looking-for-agent': return <Busy label="Looking for the Citadel Agent on this computer…" testId="sign-in-looking" />;
    case 'no-agent': return <NoAgentScreen onRetry={(): void => { void flow.retry(); }} />;
    case 'no-identity':
      return (
        <section aria-labelledby="sign-in-create-title" className="space-y-3">
          <h2 id="sign-in-create-title" className="text-lg font-semibold">Create an identity</h2>
          <CreateIdentityForm busy={state.busy} error={state.error}
            onCreate={(password: string): void => { void flow.createIdentity(password); }} onCancel={(): void => flow.cancel()} />
        </section>
      );
    case 'confirm-phrase':
      return <ConfirmPhrase phrase={state.phrase} checks={state.checks} error={state.error}
        onConfirm={(answers: string[]): void => { void flow.confirmPhrase(answers); }} onCancel={(): void => flow.cancel()} />;
    case 'beginning': return <Busy label="Starting the sign-in…" testId="sign-in-beginning" />;
    case 'consent':
      return (
        <>
          <Busy label={`Waiting for you to approve the sign-in to ${state.begun.display_name}…`} testId="sign-in-waiting" />
          <ConsentDialog displayName={state.begun.display_name} clientId={state.link.client} device={device} words={state.words}
            idFp={state.idFp} busy={state.busy} error={state.error}
            onApprove={(password: string): void => { void flow.approve(password); }} onCancel={(): void => flow.cancel()} />
        </>
      );
    case 'returning': return <Busy label={`Signed in. Returning you to ${state.client.display_name}…`} testId="sign-in-returning" />;
    case 'cancelled': return <Cancelled />;
    case 'failed':
      return <Stopped code={state.code} testId="sign-in-failed"
        action={state.restartable ? { label: 'Start again', run: (): void => { void flow.restart(); } } : undefined} />;
  }
}

/** The page over any ports; the route below gives it the browser's. */
export function SignInPage({ ports }: { ports: () => SignInPorts }): JSX.Element {
  useAgentOptionalHere();
  const { search } = useLocation();
  const { state, flow } = useSignInFlow(search, ports);
  const device: string = useMemo(() => describeDevice(navigator.userAgent), []);
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <CitadelLogo variant="horizontal" height={30} />
          <Link to="/" className="tap-target rounded-md px-1 text-sm text-primary-accent underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Citadel home
          </Link>
        </header>
        <h1 className="mb-4 text-2xl font-semibold">Sign in with Citadel</h1>
        <Step state={state} flow={flow} device={device} />
      </div>
    </main>
  );
}

export default function SignIn(): JSX.Element {
  return <SignInPage ports={browserPorts} />;
}
