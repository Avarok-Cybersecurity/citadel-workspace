import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { BRAND_NAME } from '@/components/brand/artwork/brand-rules.generated';
import { LegalLinks } from '@/components/terms/LegalLinks';
import { StepIndicator } from '@/components/ui/step-indicator';

export interface CreateWorkspaceLayoutProps {
  /** 1-based position among the form steps, or `undefined` on an outcome screen. */
  readonly stepNumber: number | undefined;
  readonly stepLabels: readonly string[];
  readonly children: ReactNode;
}

/**
 * The branded frame every create-workspace screen sits in.
 *
 * The same ground as the landing page -- solid background, the faint dot grid
 * and the purple wash -- so arriving here reads as the next page of the same
 * site rather than a form bolted on. The logo sits on the plain background, as
 * the brand guidelines require, and is never recoloured: the lockup takes its
 * colours from brand-tokens.css, which flips the cut with the theme.
 */
export function CreateWorkspaceLayout({ stepNumber, stepLabels, children }: CreateWorkspaceLayoutProps): JSX.Element {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, hsl(var(--primary)) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, hsl(var(--primary-accent) / 0.10) 0%, transparent 70%)',
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-6 sm:px-6">
        <Link
          to="/"
          aria-label={`${BRAND_NAME} home`}
          className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <CitadelLogo variant="horizontal" height={30} />
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-[24px] items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-6 pt-8 sm:px-6">
        {stepNumber !== undefined && (
          <div className="mb-6">
            <StepIndicator currentStep={stepNumber} totalSteps={stepLabels.length} labels={[...stepLabels]} />
          </div>
        )}
        <div
          data-testid="create-workspace"
          className="rounded-2xl border border-border bg-card p-6 shadow-xl"
        >
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Every Citadel workspace is end-to-end encrypted with post-quantum cryptography.
        </p>
        <LegalLinks className="mt-3 flex justify-center" />
      </main>
    </div>
  );
}
