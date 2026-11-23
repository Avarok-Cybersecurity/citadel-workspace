/**
 * The Citadel Apps a document can be created in: the one list the app picker, the tree's
 * icon for a document node and the "which app opens this file" lookup (openers/) all read.
 *
 * There is deliberately no default app. A document records the app it opens in, and a
 * fallback here would silently turn "this node names no app" into "this node is a Docs
 * document", which is the distinction `node-app-metadata` exists to keep.
 */
import type { ComponentType } from 'react';
import { FileText, FileType, Sigma } from 'lucide-react';
import { DOCS_OPENS } from './first-party/docs-opens';

export const CITADEL_APP_IDS = ['docs', 'pdf', 'latex'] as const;

export type CitadelAppId = (typeof CITADEL_APP_IDS)[number];

/** The apps a file can be handed to: each has a screen that opens one. Every other app opens nothing. */
export const FILE_OPENING_APP_IDS = ['docs'] as const satisfies readonly CitadelAppId[];

export type FileOpeningAppId = (typeof FILE_OPENING_APP_IDS)[number];

export function isFileOpeningAppId(id: CitadelAppId): id is FileOpeningAppId {
  return (FILE_OPENING_APP_IDS as readonly string[]).includes(id);
}

/**
 * Every place a document can be made: the workspace tree's New document, and a chat's document
 * shared with the peer. Each place offers the app picker (CitadelAppPicker) over the apps that
 * can be made there; the creation-site test fails for a place that writes a document without it.
 */
export const DOCUMENT_CREATION_SITES = ['workspaceTree', 'chat'] as const;

export type DocumentCreationSite = (typeof DOCUMENT_CREATION_SITES)[number];

export interface CitadelApp {
  id: CitadelAppId;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * The extensions (canonical form: the manifest's `opens`) of the files this app opens, which
   * is what it really imports, not what it might one day. Empty for an app that opens no file.
   */
  opens: readonly string[];
  /** Where a document can be created in it yet; elsewhere it is listed as coming soon. */
  createdIn: readonly DocumentCreationSite[];
}

export const CITADEL_APPS: readonly CitadelApp[] = [
  {
    id: 'docs',
    name: 'Citadel Docs',
    description: 'Rich documents: headings, lists, tables and comments.',
    icon: FileText,
    // Its committed declaration, checked by the manifest's rule; it lists what the engine imports.
    opens: DOCS_OPENS.extensions,
    createdIn: ['workspaceTree', 'chat'],
  },
  {
    id: 'pdf',
    name: 'Citadel PDF',
    description: 'View, annotate and sign PDF files.',
    icon: FileType,
    // Not built yet: it opens nothing until it can.
    opens: [],
    createdIn: [],
  },
  {
    id: 'latex',
    name: 'Citadel LaTeX',
    description: 'Typeset papers and equations from LaTeX source.',
    icon: Sigma,
    opens: [],
    createdIn: [],
  },
];

export function isCitadelAppId(value: unknown): value is CitadelAppId {
  return typeof value === 'string' && (CITADEL_APP_IDS as readonly string[]).includes(value);
}

/** The app with this id. Every id has an entry, so this cannot miss. */
export function citadelApp(id: CitadelAppId): CitadelApp {
  const app: CitadelApp | undefined = CITADEL_APPS.find((a: CitadelApp): boolean => a.id === id);
  if (!app) throw new Error(`Citadel App '${id}' has no registry entry`);
  return app;
}

/** Whether a document in `app` can be made at `site` now. */
export function creatableIn(app: CitadelApp, site: DocumentCreationSite): boolean {
  return app.createdIn.includes(site);
}
