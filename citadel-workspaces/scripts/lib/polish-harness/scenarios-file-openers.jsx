/**
 * Opening a file in the app registered for it: the real menus over the real opener lookup.
 *
 *   file-open-menu       a stored .docx in the file manager, its right-click menu's target
 *   file-open-inspector  the inspector for the same file (where a tapped file's actions are)
 *   chat-file-open-menu  two files shared in a chat: a .docx Docs opens, a .zip no app opens
 *   file-open-with-menu  a .md two apps open (Docs and an installed one): Open, and Open with…
 *   ics-import-review    an opened .ics's review in the Calendar, long names, a skipped event
 */
import { VFSContextMenu } from '@/components/file-manager/VFSContextMenu';
import { VFSInspector } from '@/components/file-manager/VFSInspector';
import { openersOfNode } from '@/components/file-manager/file-openers';
import { BUILT_IN_OPENERS } from '@/lib/citadel-apps/openers/built-in-openers';
import { ServerFileCard } from '@/components/chat/attachments/ServerFileCard';
import { AttachmentIOContext } from '@/components/chat/attachments/attachment-io';
import { RevfsFileState } from '@/types/revfs-types';
import { IcsImportReview } from '@/components/calendar/IcsImportReview';
import { NotebookPen } from 'lucide-react';

const NOOP = () => {};
const DOCX = { name: 'Quarterly-plan.docx', path: '/Reports/Quarterly-plan.docx', type: 'file', fileState: RevfsFileState.Remote, createdAt: 0, updatedAt: 0, fileMetadata: { fileSize: 2048 } };
/** The file manager's actions: the product's opener lookup, and nothing behind the rest. */
const ACTIONS = new Proxy({ openersOf: (node) => openersOfNode(node, BUILT_IN_OPENERS, null) }, { get: (t, k) => t[k] ?? NOOP });

function FileOpenMenu() {
  return (
    <div data-testid="fm-screen" style={{ padding: 16 }}>
      <VFSContextMenu node={DOCX} folder="/Reports" actions={ACTIONS} hasPasteItems={false} onStartRename={NOOP}>
        <div data-testid="fm-target" tabIndex={0} style={{ padding: 12, border: '1px solid' }}>{DOCX.name}</div>
      </VFSContextMenu>
    </div>
  );
}

function FileOpenInspector() {
  return (
    <div data-testid="fm-screen" style={{ display: 'flex', justifyContent: 'flex-end', height: '100vh' }}>
      <VFSInspector node={DOCX} actions={ACTIONS} peerName={null} storageName="Server Storage" from={null} modified="today" onClose={NOOP} />
    </div>
  );
}

const IO = { read: async () => new TextEncoder().encode('plain'), files: { save: NOOP } };
const file = (id, name, mime) => ({ id: id.repeat(64), name, size: 2048, mime });

function ChatFileOpenMenu() {
  return (
    <AttachmentIOContext.Provider value={IO}>
      <div data-testid="chat-files" className="flex flex-col gap-3 p-4">
        {[file('a', 'Quarterly-plan.docx', ''), file('b', 'archive.zip', 'application/zip')].map((f) => (
          <div key={f.id} data-testid={`chat-bubble-${f.name}`} className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-foreground"><ServerFileCard file={f} /></div>
        ))}
      </div>
    </AttachmentIOContext.Provider>
  );
}

export const FILE_OPENER_SCENARIOS = { 'file-open-menu': FileOpenMenu, 'file-open-inspector': FileOpenInspector, 'chat-file-open-menu': ChatFileOpenMenu };

const MD = { ...DOCX, name: 'Meeting-minutes.md', path: '/Reports/Meeting-minutes.md' };
/** An installed app that also opens .md, as installed-openers.ts makes one. */
const NOTEBOOK = { kind: 'installed', id: 'com.example.notebook', name: 'Notebook', icon: NotebookPen, firstParty: false, opens: ['md'], maxBytes: 1024n, where: null };
const WITH_NOTEBOOK = new Proxy({ openersOf: (node) => openersOfNode(node, [...BUILT_IN_OPENERS, NOTEBOOK], null) }, { get: (t, k) => t[k] ?? NOOP });

function FileOpenWithMenu() {
  return (
    <div data-testid="fm-screen" style={{ padding: 16 }}>
      <VFSContextMenu node={MD} folder="/Reports" actions={WITH_NOTEBOOK} hasPasteItems={false} onStartRename={NOOP}>
        <div data-testid="fm-target" tabIndex={0} style={{ padding: 12, border: '1px solid' }}>{MD.name}</div>
      </VFSContextMenu>
    </div>
  );
}

const day = (title, d) => ({ uid: `${title}@example`, title, body: null, location: null, when: { all_day: { date: { y: 2026, m: 12, d }, days: 1 } }, zone: 'America/New_York', cancelled: false });
const READING = {
  ok: true,
  drafts: [day('Boiler service with the contractor from the north depot, second visit of the quarter', 1), day('Site visit', 2), day('', 3)],
  skipped: [{ index: 4, uid: null, why: 'no start' }],
  cancelled: 1,
};
// All-day drafts are worded without the core's clock, so none is passed.
const NO_CLOCK = { civilOf: () => { throw new Error('an all-day draft needs no clock'); } };

function IcsReview() {
  return <IcsImportReview fileName="facilities-team-calendar-december-2026-export.ics" reading={READING} floatingZone="America/New_York" engine={NO_CLOCK} onImport={async () => null} onClose={NOOP} />;
}

Object.assign(FILE_OPENER_SCENARIOS, { 'file-open-with-menu': FileOpenWithMenu, 'ics-import-review': IcsReview });
