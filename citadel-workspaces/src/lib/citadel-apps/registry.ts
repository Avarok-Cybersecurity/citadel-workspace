/**
 * The Citadel Apps a document can be created in: the one list the app picker, the tree's
 * icon for a document node and (later) the file manager's extension mapping all read.
 *
 * There is deliberately no default app. A document records the app it opens in, and a
 * fallback here would silently turn "this node names no app" into "this node is a Docs
 * document", which is the distinction `node-app-metadata` exists to keep.
 */
import type { ComponentType } from 'react';
import { FileText, FileType, Sigma } from 'lucide-react';
import { DOCS_IMPORT_FORMATS } from './docs-import-formats';

export const CITADEL_APP_IDS = ['docs', 'pdf', 'latex'] as const;

export type CitadelAppId = (typeof CITADEL_APP_IDS)[number];

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
  /** Extensions, without the dot, of the files this app opens. */
  fileExtensions: readonly string[];
  /** Where a document can be created in it yet; elsewhere it is listed as coming soon. */
  createdIn: readonly DocumentCreationSite[];
}

export const CITADEL_APPS: readonly CitadelApp[] = [
  {
    id: 'docs',
    name: 'Citadel Docs',
    description: 'Rich documents: headings, lists, tables and comments.',
    icon: FileText,
    fileExtensions: ['cdoc', ...DOCS_IMPORT_FORMATS],
    createdIn: ['workspaceTree', 'chat'],
  },
  {
    id: 'pdf',
    name: 'Citadel PDF',
    description: 'View, annotate and sign PDF files.',
    icon: FileType,
    fileExtensions: ['pdf'],
    createdIn: [],
  },
  {
    id: 'latex',
    name: 'Citadel LaTeX',
    description: 'Typeset papers and equations from LaTeX source.',
    icon: Sigma,
    fileExtensions: ['tex'],
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
