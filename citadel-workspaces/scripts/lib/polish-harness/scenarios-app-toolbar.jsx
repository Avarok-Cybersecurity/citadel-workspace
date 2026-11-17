/** An app's toolbar at its fullest: the most buttons it may have, the longest labels, one without a break. */
import { useEffect, useRef } from 'react';
import { zoneToolbar } from '@/lib/citadel-apps/runtime/zone-toolbar';
import { MAX_TOOLBAR_ITEMS, MAX_TOOLBAR_LABEL_CHARS } from '@/lib/citadel-apps/runtime/toolbar-model';

const LABELS = ['Run', 'Stop', 'Workers', 'x'.repeat(MAX_TOOLBAR_LABEL_CHARS), 'Clear results', 'Export primes as a CSV file', '<b>Plain</b>', 'Settings'];

function Toolbar() {
  const slot = useRef(null);
  useEffect(() => {
    const bar = zoneToolbar(document, 'Compute Pool', () => {});
    slot.current.append(bar.element);
    bar.set(LABELS.slice(0, MAX_TOOLBAR_ITEMS).map((label, i) => ({ id: `item-${i}`, label })));
    return () => bar.dispose();
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <div ref={slot} />
      <div data-testid="app-toolbar-zone" className="w-full rounded-lg border border-border" style={{ height: 240 }} />
    </div>
  );
}

export const APP_TOOLBAR_SCENARIOS = { 'app-toolbar-full': Toolbar };
