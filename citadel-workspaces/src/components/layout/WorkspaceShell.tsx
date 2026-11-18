import { Outlet } from 'react-router-dom';
import { AppLayout } from './AppLayout';

/**
 * The signed-in shell, owned by the route table rather than by each page.
 *
 * Every page used to wrap itself in `<AppLayout>`, so moving between them
 * unmounted the skip link, top bar and sidebar and mounted identical copies.
 * Navigation is a transition, so the outgoing copy stays on screen until the
 * incoming page renders: a Tab in that window focused a skip link that was
 * about to be removed, and focus fell to <body>. One shell for every route
 * means only the page inside <main> changes.
 */
export function WorkspaceShell(): JSX.Element {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
