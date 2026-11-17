/**
 * The file manager, assembled from its real parts with typed-in input: the top bar, the address bar, the
 * browser (list or grid, inspector or bulk bar) and the footer, in the states the redesign has to hold --
 * list, grid, one item inspected, several selected, transfers open, an empty folder, a deep path.
 * The services behind FileManagerContent are not here; nothing here replaces a component.
 */
import { FileManagerTopBar } from '@/components/file-manager/FileManagerTopBar';
import { FileManagerAddressBar } from '@/components/file-manager/FileManagerAddressBar';
import { FileManagerBrowser } from '@/components/file-manager/FileManagerBrowser';
import { TransfersPanel } from '@/components/file-manager/TransfersPanel';
import { FileManagerStatusStrip } from '@/components/file-manager/FileManagerStatusStrip';
import { selectionPanel } from '@/components/file-manager/selection-panel';
import { itemCountLabel } from '@/components/file-manager/address-bar-model';
import { findNodeByPath } from '@/lib/revfs/tree-operations';
import { TreeScope } from '@/types/revfs-types';
import { Shell } from './scenarios-screens.jsx';

const NOTHING = () => {};

/** Every action a view can take, doing nothing: the harness measures layout, not behaviour. */
export const NO_ACTIONS = {
  openFolder: NOTHING, openFile: NOTHING, inspect: NOTHING, download: NOTHING, share: NOTHING, moveTo: NOTHING,
  copyLink: NOTHING, remove: NOTHING, rename: async () => {}, cut: NOTHING, copy: NOTHING, paste: async () => {},
  newFolder: NOTHING, upload: NOTHING, refresh: NOTHING, drop: NOTHING, openInDocs: NOTHING,
};

const ME = 1n;
const ADA_CID = 2n;
const ADA = { cid: ADA_CID, username: 'ada', displayName: 'Ada Lovelace', isOnline: true, isConnected: true, connectionPath: null };
const GRACE = { cid: 3n, username: 'grace', displayName: 'Grace Hopper', isOnline: true, isConnected: false, connectionPath: null };
const today = (h, m) => new Date().setHours(h, m, 0, 0);

const file = (dir, name, size, type, by, at, state) => ({
  name, type: 'file', path: `${dir === '/' ? '' : dir}/${name}`, createdAt: at, updatedAt: at, fileState: state,
  fileMetadata: { fileId: name, fileName: name, fileSize: size, fileType: type, virtualDirectory: dir, uploadedByCid: by },
});
const folder = (path, children, at) => ({ name: path.split('/').pop(), type: 'directory', path, createdAt: at, updatedAt: at, children });

const DEEP = '/Designs/Archive/2026 drawings/Bridge revisions';
const TREE = folder('/', [
  folder('/Sent Files', [], 1),
  folder('/Received Files', [], 1),
  folder('/Designs', [folder('/Designs/Archive', [folder('/Designs/Archive/2026 drawings', [folder(DEEP, [
    file(DEEP, 'span-detail-rev-c.dwg', 8_400_000, 'application/acad', ADA_CID, today(9, 12), 'Remote'),
  ], today(9, 0))], today(9, 0))], today(9, 0))], today(8, 30)),
  folder('/Empty', [], today(8, 0)),
  file('/', 'analytical-engine-notes-final-v3-with-the-long-appendix.pdf', 2_400_000, 'application/pdf', ADA_CID, today(10, 4), 'Remote'),
  file('/', 'budget.xlsx', 48_000, 'application/vnd.ms-excel', ME, today(9, 41), 'Remote'),
  file('/', 'launch-slides.pptx', 12_600_000, 'application/vnd.ms-powerpoint', ADA_CID, 1_760_000_000_000, 'Hosted'),
  file('/', 'README', 1_200, 'text/plain', ME, 1_750_000_000_000, 'Remote'),
]);

const TRANSFERS = [
  { id: 't1', name: 'span-detail-rev-c.dwg', status: 'active', percent: 62, figure: '62% · 1.4 MB/s', line: 'From Ada Lovelace · about 4 s left' },
  { id: 't2', name: 'budget.xlsx', status: 'done', percent: 100, figure: 'Done', line: 'Received 09:41 · verified' },
  { id: 't3', name: 'launch-slides.pptx', status: 'failed', percent: 18, figure: 'Failed', line: 'To Ada Lovelace · the connection dropped' },
];

/** The screen the redesign draws, from the parts FileManagerContent assembles, in a given state. */
function Screen({ path = '/', view = 'list', selected = [], transfers = false, filter = '', storage = { kind: 'peer', cid: ADA_CID } }) {
  const isPeer = storage.kind === 'peer';
  const storageLabel = isPeer ? ADA.displayName : 'Server';
  const storageName = isPeer ? `Shared with ${ADA.displayName}` : 'Server Storage';
  const selectedPaths = new Set(selected);
  const open = findNodeByPath(TREE, path);
  const fm = {
    storageMode: isPeer ? TreeScope.Peer : TreeScope.Server, storageLabel, storageName, currentPath: path, missingItem: null,
    pendingPaths: new Set(isPeer ? ['/README'] : []), cutItemPaths: new Set(), hasPasteItems: false, selectedPaths,
    selectItem: NOTHING, handleSelectAll: NOTHING, clearSelection: NOTHING, sortField: 'name', sortDirection: 'asc',
    filterText: filter, setFilterText: NOTHING, storageOffer: { kind: 'offered' },
  };
  const v = {
    view, actions: NO_ACTIONS, panel: selectionPanel(TREE, selectedPaths),
    nameOf: (cid) => (cid === ME ? 'You' : ADA.displayName),
  };
  const footer = (
    <>
      {transfers && <TransfersPanel rows={TRANSFERS} active={1} pendingPaths={fm.pendingPaths} peerLabel={storageLabel} onClose={NOTHING} />}
      <FileManagerStatusStrip connectedPeers={1} storageName={storageName} usedBytes={23_400_000} quotaBytes={1_073_741_824} hostingFor={isPeer ? storageLabel : null} />
    </>
  );
  return (
    <Shell>
      <div style={{ height: '100vh', width: '100%' }} className="flex min-w-0 flex-col bg-background" data-testid="fm-screen">
        <FileManagerTopBar
          storage={storage} peers={[ADA, GRACE]} peersLoading={false} peerName={isPeer ? storageLabel : null} onOpenStorage={NOTHING}
          folder={{ filterText: filter, onFilterChange: NOTHING, onNewFolder: NOTHING, onUpload: NOTHING, upload: { kind: 'offered' } }}
          transfers={{ active: 1, open: transfers, onToggle: NOTHING }}
        />
        <FileManagerAddressBar
          tree={TREE} path={path} onOpenFolder={NOTHING} back={path === '/' ? null : NOTHING} up={path === '/' ? null : NOTHING}
          countLabel={open ? itemCountLabel(open.children ?? []) : null} sortField="name" sortDirection="asc" onSortChange={NOTHING}
          view={view} onViewChange={NOTHING} onRefresh={NOTHING} refreshLabel={isPeer ? 'Sync with peer' : 'Refresh'}
        />
        <div className="flex min-h-0 flex-1 flex-col"><FileManagerBrowser fm={fm} v={v} tree={TREE} footer={footer} /></div>
      </div>
    </Shell>
  );
}

const PDF = '/analytical-engine-notes-final-v3-with-the-long-appendix.pdf';

export const FILE_MANAGER_SCENARIOS = {
  'file-manager': () => <Screen />,
  'file-manager-grid': () => <Screen view="grid" />,
  'file-manager-inspector': () => <Screen selected={[PDF]} />,
  'file-manager-bulk': () => <Screen selected={[PDF, '/budget.xlsx', '/Designs']} />,
  'file-manager-transfers': () => <Screen transfers />,
  'file-manager-empty': () => <Screen path="/Empty" storage={{ kind: 'server' }} />,
  'file-manager-no-matches': () => <Screen filter="quarterly" />,
  'file-manager-deep': () => <Screen path={DEEP} />,
};
