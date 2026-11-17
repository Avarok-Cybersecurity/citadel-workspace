import { useEffect } from 'react';
import { useRememberLocation } from './use-remember-location';
import { useLiveDocMigrationSweep } from '@/hooks/use-live-doc-migration-sweep';
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { TopBar } from "./sidebar/TopBar";
import { HierarchySidebar } from "./sidebar/HierarchySidebar";
import { MembersSection } from "./sidebar/MembersSection";
import { FilesSection } from "./sidebar/FilesSection";
import { AdminSettingsSection } from "./sidebar/AdminSettingsSection";
import { TermsGate } from "@/components/terms/TermsGate";
import { CalendarInBackground } from "@/components/calendar/background/CalendarInBackground";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps): JSX.Element => {
  // Records where this session is, so claiming it tomorrow returns here rather
  // than to the default office. Inside AppLayout because that is exactly the
  // set of routes worth returning to -- the pre-auth screens do not mount it.
  useRememberLocation();
  // Moves this account's chat documents to Citadel Docs once, in the background, after sign-in.
  useLiveDocMigrationSweep();

  return (
    <SidebarProvider>
      {/* `--app-height` is published by keyboard-inset.ts on browsers that do
          not honour `interactive-widget=resizes-content` (i.e. WebKit), and is
          absent otherwise — so this is dvh everywhere it already worked.
          `pb-[env(safe-area-inset-bottom)]` keeps the composer's bottom edge out
          of the iPhone home-indicator gesture zone in standalone; iOS reserves
          the status bar for us but not the bottom inset, and the value is 0
          everywhere else. */}
      <AppHeaderHeightVar />
      {/* The shell states that it mounted. scripts/lib/app-mounted.mjs asks for
          `sign-in-button`, `create-account-button` or this -- the first two exist
          only on the landing page, so before this testid existed the third arm of
          that union could never match and the helper could not recognise a mounted
          app anywhere past login. The two live arms hid it: the union kept working
          on the one page it was used on. */}
      <div data-testid="app-shell" className="h-[var(--app-height,100dvh)] pb-[env(safe-area-inset-bottom)] flex w-full bg-background text-foreground overflow-hidden">
        {/*
          First tab stop, visible only once focused. The workspace renders 43
          tabbable controls and had NO landmarks at all, so reaching the content
          by keyboard meant tabbing through the entire sidebar every time, and a
          screen reader had no structure to jump by. axe does not report it:
          its `region` rule is moderate impact, under the serious/critical gate
          this suite fails on.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-foreground focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        >
          Skip to main content
        </a>

        <TopBar />

        {/* The sidebar IS the app's navigation; naming it lets a screen reader
            skip past it or jump straight to it. */}
        <Sidebar className="pt-[calc(3.5rem+var(--offline-banner-height,0px))] bg-input border-r border-border transition-transform duration-300 ease-in-out">
          <SidebarContent>
            <nav aria-label="Workspace navigation">
              <HierarchySidebar />
              <MembersSection />
              <FilesSection />
              <AdminSettingsSection />
            </nav>
          </SidebarContent>
        </Sidebar>

        {/* tabIndex={-1} so the skip link can move focus here; without it the
            anchor scrolls the page and leaves focus back up in the sidebar. */}
        <main
          id="main-content"
          tabIndex={-1}
          // The offline banner is `fixed`, so it takes no space and would cover
          // the first ~36px of this pane — it publishes its measured height and
          // both panes make room. Measured, not hardcoded: the copy wraps to two
          // lines at 375px.
          className="flex-1 pt-[calc(3.5rem+var(--offline-banner-height,0px))] pl-0 overflow-x-hidden overflow-y-auto h-full focus:outline-none"
        >
          {children}
        </main>
      </div>
      <TermsGate />
      <CalendarInBackground />
    </SidebarProvider>
  );
};

/**
 * Publishes the app header's height while this layout is mounted.
 *
 * The offline banner is fixed and mounted globally, above the router, and sat
 * at a hardcoded `top-14` on every route — including the landing page, which has
 * no header at all. There it floated in mid-air over the hero, which is exactly
 * the offline cold-start screen. Driving the offset from a variable the header's
 * owner publishes means it is below the header where there is one and at the top
 * where there is not, without the banner having to know about routes.
 */
function AppHeaderHeightVar(): null {
  useEffect(() => {
    const root: HTMLElement = document.documentElement;
    root.style.setProperty('--app-header-height', '3.5rem');
    return (): void => {
      root.style.removeProperty('--app-header-height');
    };
  }, []);
  return null;
}
