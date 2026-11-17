import { lazyDialog } from '@/components/lazy-dialog';
import type { AppsModalProps } from './AppsModal';

/** AppsModal, off the landing critical path: fetched on its first open (check-bundle-budget.mjs). */
export const LazyAppsModal: (props: AppsModalProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<AppsModalProps>> => import('./AppsModal').then((m) => m.AppsModal),
  (props: AppsModalProps): boolean => props.open,
);
