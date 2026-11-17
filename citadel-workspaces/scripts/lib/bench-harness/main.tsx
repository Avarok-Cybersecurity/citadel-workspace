/**
 * The Citadel Docs benchmark page (citadel-docs bench/competitors, the browser protocol): the
 * shipped editor, ribbons and status bar opening a .docx from a file input, with no agent and
 * no workspace. Not part of the app: nothing in src/ imports it (src/__tests__/the-bench-
 * harness-is-not-in-the-app.test.ts), and serve.mjs builds it on its own.
 */
import { createRoot, type Root } from 'react-dom/client';
import '@/index.css';
import '@/styles/brand-tokens.css';
import { BenchHarness } from './BenchHarness';

const root: HTMLElement | null = document.getElementById('root');
if (root === null) throw new Error('the harness page has no #root');
const app: Root = createRoot(root);
app.render(<BenchHarness />);
