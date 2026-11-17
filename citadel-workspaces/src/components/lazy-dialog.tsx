import { lazy, Suspense, useState } from "react";

/**
 * A dialog fetched on its first open and kept mounted after it, so closing keeps
 * its exit animation. For dialogs rendered on the landing page that most visits
 * never open: their code stays off the critical path that
 * scripts/check-bundle-budget.mjs holds to its budget.
 *
 * `isOpen` names which prop opens it, since the dialogs here disagree (`open`
 * vs `isOpen`).
 */
export function lazyDialog<P extends object>(
  load: () => Promise<React.ComponentType<P>>,
  isOpen: (props: P) => boolean,
): (props: P) => JSX.Element | null {
  // The loaded dialog is rendered inside a wrapper with a concrete prop shape:
  // `lazy()` wraps its component's props in ref types that a generic P cannot
  // be checked against.
  const Dialog: React.LazyExoticComponent<(wrapped: { props: P }) => JSX.Element> = lazy(
    async (): Promise<{ default: (wrapped: { props: P }) => JSX.Element }> => {
      const Loaded: React.ComponentType<P> = await load();
      return { default: (wrapped: { props: P }): JSX.Element => <Loaded {...wrapped.props} /> };
    },
  );
  return function LazyDialog(props: P): JSX.Element | null {
    const open: boolean = isOpen(props);
    const [everOpened, setEverOpened] = useState<boolean>(open);
    if (open && !everOpened) setEverOpened(true);
    if (!everOpened) return null;
    return (
      <Suspense fallback={null}>
        <Dialog props={props} />
      </Suspense>
    );
  };
}
