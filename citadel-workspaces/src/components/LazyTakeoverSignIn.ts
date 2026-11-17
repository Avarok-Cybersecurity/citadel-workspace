import { lazyDialog } from "./lazy-dialog";
import type { TakeoverSignInProps } from "./TakeoverSignIn";

/** TakeoverSignIn, off the landing critical path: it brings the whole sign-in form, which the previous-sessions bar only needs once a takeover is chosen. */
export const LazyTakeoverSignIn: (props: TakeoverSignInProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<TakeoverSignInProps>> => import("./TakeoverSignIn").then((m) => m.TakeoverSignIn),
  (props: TakeoverSignInProps): boolean => props.request !== null,
);
