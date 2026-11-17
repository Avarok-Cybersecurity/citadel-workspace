import { lazyDialog } from "@/components/lazy-dialog";
import type { LandingStepsProps } from "./LandingSteps";

/** The sign-in and registration steps, fetched when one is first opened: none is on screen at landing. */
export const LazyLandingSteps: (props: LandingStepsProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<LandingStepsProps>> => import("./LandingSteps").then((m) => m.LandingSteps),
  (props: LandingStepsProps): boolean => props.currentStep !== 'none',
);
