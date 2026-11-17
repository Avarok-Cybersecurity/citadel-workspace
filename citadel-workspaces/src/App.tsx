import { lazy, Suspense , type LazyExoticComponent } from "react";
import { ThemeProvider } from "next-themes";
import { ConfirmDialogProvider } from "@/components/shared/confirm-dialog";
import { PromptDialogProvider } from "@/components/shared/prompt-dialog";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import WorkspaceApp from "./components/WorkspaceApp";
import { DocumentTitle } from './components/DocumentTitle';
import { useSendFailureToasts } from '@/hooks/use-send-failure-toasts';
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { RouteFallback } from "./components/RouteFallback";
import { PwaUpdatePrompt } from "./components/pwa/PwaUpdatePrompt";
import { ThemeColorSync } from "./components/theme/ThemeColorSync";
import { OfflineBanner } from "./components/pwa/OfflineBanner";
import { PersistFailureNotice } from "./components/PersistFailureNotice";
import { PeerRefusalNotice } from "./components/PeerRefusalNotice";
import { SecurityKeyPromptHost } from "./components/sign-in/SecurityKeyPromptHost";
import { CallLayer } from "./components/call/CallLayer";
import { OngoingCallBar } from "./components/call/OngoingCallBar";

// Landing is the route almost every session starts on, so it is imported eagerly:
// code-splitting it would only add a network round trip before first paint.
import Landing from "./pages/Landing";

/**
 * Every other route is split out. Nothing here was split before, so a visitor to
 * the landing page downloaded the workspace shell, the group chat page, the file
 * manager and the collaborative editor (TipTap + Yjs + ProseMirror) before it
 * could render — none of which that page uses.
 */
const Office: LazyExoticComponent<() => JSX.Element> = lazy((): Promise<{ default: never; } | { default: () => JSX.Element; }> =>
  import("@/components/Office").then(m => ({ default: m.Office }))
);
const Messages: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/Messages"));
// Off the landing critical path (check-bundle-budget): both leave a workspace whose session ended,
// asking about unsaved editor text first, which only an open workspace can have.
const SessionEndedWatcher: LazyExoticComponent<() => null> = lazy(() => import("./components/SessionEndedWatcher").then((m) => ({ default: m.SessionEndedWatcher })));
const ServerReconnectWatcher: LazyExoticComponent<() => null> = lazy(() => import("./components/ServerReconnectWatcher").then((m) => ({ default: m.ServerReconnectWatcher })));
const SignInNeededWatcher: LazyExoticComponent<() => JSX.Element | null> = lazy(() => import("./components/SignInNeededWatcher").then((m) => ({ default: m.SignInNeededWatcher })));
const AgentUpdateWatcher: LazyExoticComponent<() => JSX.Element | null> = lazy(() => import("./components/agent-update/AgentUpdateWatcher").then((m) => ({ default: m.AgentUpdateWatcher })));
const Connect: LazyExoticComponent<() => JSX.Element> = lazy((): Promise<{ default: never; } | { default: () => JSX.Element; }> =>
  import("./pages/Connect").then(m => ({ default: m.Connect }))
);
const UserDirectory: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/UserDirectory"));
const GroupChatPage: LazyExoticComponent<() => JSX.Element> = lazy((): Promise<{ default: never; } | { default: () => JSX.Element; }> =>
  import("./pages/GroupChatPage").then(m => ({ default: m.GroupChatPage }))
);
const Agent: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/Agent"));
const NotFound: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/NotFound"));
// Lazy too: only the protected routes mount it, and its start-up claim path
// (retry, takeover offer) has no business on the landing page's critical path.
const WorkspaceLoader: LazyExoticComponent<React.FC<{ children: React.ReactNode }>> = lazy((): Promise<{ default: React.FC<{ children: React.ReactNode }> }> =>
  import("./components/ui/workspace-loader").then(m => ({ default: m.WorkspaceLoader }))
);
// Split like the rest: the landing page must not pay for the create-workspace
// flow, and nothing on it is needed until someone chooses to set one up.
const CreateWorkspace: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/CreateWorkspace"));
const Legal: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/Legal"));

const queryClient: QueryClient = new QueryClient();

const App: () => JSX.Element = (): JSX.Element => {
  // A message that did not go out has to reach the person who sent it.
  // `lib/p2p/send-failure.ts` has always detected, explained and throttled
  // these; nothing rendered them, so the message just sat in the thread
  // looking sent.
  useSendFailureToasts();

  return (
    <AppErrorBoundary>
      {/*
        next-themes was already a dependency and ui/sonner.tsx already called
        useTheme() — with no provider mounted, so it always read "system" and
        toasts could render light inside a permanently-dark app.

        defaultTheme="dark" keeps the product looking exactly as it does today;
        the difference is that light is now reachable rather than theoretical.
        `attribute="class"` matches tailwind.config's darkMode: ["class"], and
        disableTransitionOnChange stops every transition on the page firing at
        once when the class flips.
      */}
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
        storageKey="citadel:theme"
      >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
        {/* Inside TooltipProvider so the dialog it renders sits in the same
            overlay context as everything else, and above WorkspaceApp so any
            hook beneath can await a styled confirmation instead of reaching
            for window.confirm. */}
        <ConfirmDialogProvider>
        <PromptDialogProvider>
          <WorkspaceApp>
            {/*
              One toast system. The app used to mount shadcn's <Toaster /> AND
              <Sonner /> simultaneously, so a notification's appearance depended
              on which feature raised it. useToast() now renders through Sonner.
            */}
            <Sonner />
            <PwaUpdatePrompt />
            <ThemeColorSync />
            <OfflineBanner />
            <PersistFailureNotice />
            <PeerRefusalNotice />
            <SecurityKeyPromptHost />
            {/*
              Opt into the v7 behaviours now. Both were logging deprecation
              warnings on every boot; adopting them here means the eventual
              react-router v7 upgrade is a version bump rather than a behaviour
              change, and the console stays clean enough that a real warning
              is noticeable.
            */}
            {/* Wraps the router, not a route: a ringing call has to be
                answerable from wherever the user happens to be, and a call must
                survive navigating between rooms rather than dying with the
                page that started it. */}
            <CallLayer>
            <BrowserRouter
              future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
              <DocumentTitle />
              <Suspense fallback={null}><ServerReconnectWatcher /><SessionEndedWatcher /><SignInNeededWatcher /><AgentUpdateWatcher /></Suspense>
              {/* Inside the router because its Return button navigates, above
                  the routes because a running call has to stay visible on all
                  of them. It lived in CallLayer, which is above the router --
                  so its useNavigate() threw on every render and took the whole
                  app down to the error boundary. */}
              <OngoingCallBar />
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  {/* Public routes that don't require workspace data */}
                  <Route path="/" element={<Landing />} />
                  <Route path="/connect" element={<Connect />} />
                  <Route path="/create" element={<CreateWorkspace />} />
                  <Route path="/create/done" element={<CreateWorkspace />} />
                  <Route path="/legal/:doc" element={<Legal />} />
                  <Route path="/agent" element={<Agent />} />

                  {/* Protected routes that require workspace data to be loaded */}
                  <Route
                    path="/workspace"
                    element={
                      <WorkspaceLoader>
                        <Office />
                      </WorkspaceLoader>
                    }
                  />
                  <Route
                    path="/messages"
                    element={
                      <WorkspaceLoader>
                        <Messages />
                      </WorkspaceLoader>
                    }
                  />
                  <Route
                    path="/directory"
                    element={
                      <WorkspaceLoader>
                        <UserDirectory />
                      </WorkspaceLoader>
                    }
                  />
                  <Route
                    path="/groups/:groupId"
                    element={
                      <WorkspaceLoader>
                        <GroupChatPage />
                      </WorkspaceLoader>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
            </CallLayer>
          </WorkspaceApp>
        </PromptDialogProvider>
        </ConfirmDialogProvider>
        </TooltipProvider>
      </QueryClientProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
};

export default App;
