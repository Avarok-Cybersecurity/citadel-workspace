/**
 * An .ics file opened in the Calendar, over its pane: read once into drafts in the member's display
 * zone, reviewed (IcsImportReview), and saved as their private events only on Import. Ids and the
 * clock are read here, at the tab's edge, as the pane reads them.
 */
import { useMemo } from 'react';
import { toast } from 'sonner';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { Draft } from '@/lib/calendar/generated/Draft';
import { importDrafts, readIcs, type IcsReading } from '@/lib/calendar/ics-import';
import type { CalendarPorts } from '@/lib/calendar/ports';
import type { OpenedFile } from '@/lib/citadel-apps/runtime/opened-files';
import { IcsImportReview } from './IcsImportReview';

export interface OpenedIcsProps {
  readonly file: OpenedFile;
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly displayZone: string;
  readonly nodeId: string;
  readonly me: string;
  readonly onDone: () => void;
}

export function OpenedIcs({ file, ports, engine, displayZone, nodeId, me, onDone }: OpenedIcsProps): JSX.Element {
  const reading: IcsReading = useMemo(() => readIcs(engine, file.bytes, displayZone), [engine, file, displayZone]);
  const run = (drafts: readonly Draft[]): Promise<string | null> =>
    importDrafts(ports, engine, drafts, { id: (): string => crypto.randomUUID(), node: nodeId, me, nowMs: BigInt(Math.floor(ports.clock.now())) });
  const close = (imported: number): void => {
    onDone();
    if (imported > 0) toast.success(`${imported === 1 ? '1 event' : `${imported} events`} from ${file.name} added to your calendar`);
  };
  return <IcsImportReview fileName={file.name} reading={reading} floatingZone={displayZone} engine={engine} onImport={run} onClose={close} />;
}
