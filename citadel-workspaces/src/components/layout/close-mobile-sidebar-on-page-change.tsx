import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSidebar } from '@/components/ui/sidebar';

/**
 * Closes the mobile navigation sheet when the page (the pathname) changes.
 *
 * The sheet once closed as a side effect of every page mounting its own shell.
 * One shell now spans every page (WorkspaceShell), so the close is stated. A
 * search-only change stays with the control that made it: the tree closes the
 * sheet itself when a node is chosen.
 */
export function CloseMobileSidebarOnPageChange(): null {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  return null;
}
