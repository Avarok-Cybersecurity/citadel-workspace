import { lazyDialog } from "./lazy-dialog";
import type { SettingsModal } from "./SettingsModal";

type SettingsModalProps = React.ComponentProps<typeof SettingsModal>;

/** SettingsModal, off the landing critical path: every settings tab comes with it. */
export const LazySettingsModal: (props: SettingsModalProps) => JSX.Element | null = lazyDialog(
  (): Promise<React.ComponentType<SettingsModalProps>> => import("./SettingsModal").then((m) => m.SettingsModal),
  (props: SettingsModalProps): boolean => props.open,
);
