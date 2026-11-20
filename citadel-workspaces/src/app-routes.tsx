import { lazy, Suspense, type LazyExoticComponent } from "react";
import { Routes, Route, type FutureConfig } from "react-router-dom";
import { RouteFallback } from "./components/RouteFallback";

// Landing is the route almost every session starts on, so it is imported eagerly:
// code-splitting it would only add a network round trip before first paint.
import Landing from "./pages/Landing";

/**
 * The router's opt-ins, read by every router that renders `AppRoutes`.
 *
 * Both were logging deprecation warnings on every boot; adopting them means the
 * eventual react-router v7 upgrade is a version bump rather than a behaviour
 * change. `v7_startTransition` matters beyond that: navigation is a transition,
 * so the outgoing route stays on screen until the incoming one has rendered.
 */
export const ROUTER_FUTURE: Partial<FutureConfig> = { v7_startTransition: true, v7_relativeSplatPath: true };

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
const WorkspaceShell: LazyExoticComponent<() => JSX.Element> = lazy((): Promise<{ default: () => JSX.Element }> =>
  import("./components/layout/WorkspaceShell").then(m => ({ default: m.WorkspaceShell }))
);
// Split like the rest: the landing page must not pay for the create-workspace
// flow, and nothing on it is needed until someone chooses to set one up.
const CreateWorkspace: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/CreateWorkspace"));
const Legal: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/Legal"));
// "Sign in with Citadel" (an app's link lands here): its flow, the match-phrase hash and the word
// list load only for that link.
const SignIn: LazyExoticComponent<() => JSX.Element> = lazy(() => import("./pages/SignIn"));

/** The route table. Rendered inside a router configured with `ROUTER_FUTURE`. */
export function AppRoutes(): JSX.Element {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public routes that don't require workspace data */}
        <Route path="/" element={<Landing />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/create" element={<CreateWorkspace />} />
        <Route path="/create/done" element={<CreateWorkspace />} />
        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/agent" element={<Agent />} />
        <Route path="/sign-in" element={<SignIn />} />

        {/* Protected routes that require workspace data to be loaded. One
            loader and one shell for all of them: a page changes inside <main>,
            and the skip link, top bar and sidebar stay the same elements. */}
        <Route
          element={
            <WorkspaceLoader>
              <WorkspaceShell />
            </WorkspaceLoader>
          }
        >
          <Route path="/workspace" element={<Office />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/directory" element={<UserDirectory />} />
          <Route path="/groups/:groupId" element={<GroupChatPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
