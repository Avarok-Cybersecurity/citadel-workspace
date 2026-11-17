/**
 * Reaching a node in the hierarchy sidebar.
 *
 * The sidebar is a focused tree: it shows the path down to the selected node,
 * that node with its siblings, and its children -- never the whole estate. A
 * node two levels away from the selection is not on screen at all, so "find the
 * row with this name" only works for whatever happens to be near the selection.
 *
 * revealNode is the one way to bring any node on screen. It asks the sidebar's
 * filter where the node lives (each result's title is its path), then clicks
 * down that path from the workspace root, one level at a time, exactly as a
 * person would. The node ends up selected, which is what navigating to it means.
 *
 * Rows are matched by role and accessible name. A row leaving mid-animation has
 * neither (see tree-motion.tsx), so a row on its way out is never matched.
 */

import type { Locator, Page } from 'playwright';
import { isHiddenWithin, isVisibleWithin, sleep } from './utils.js';

const PATH_SEPARATOR = ' › ';
const STEP_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 500;

/** The hierarchy tree itself. */
export function hierarchyTree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Workspace hierarchy' });
}

/** Rows named exactly `nodeName`, optionally at one true depth (1 is the root). */
export function treeRow(page: Page, nodeName: string, level?: number): Locator {
  const rows: Locator = hierarchyTree(page).getByRole('treeitem', { name: nodeName, exact: true });
  return level === undefined ? rows : rows.and(page.locator(`[aria-level="${level}"]`));
}

/** The workspace root's row, whatever the workspace is called. */
export function rootRow(page: Page): Locator {
  return hierarchyTree(page).locator('[role="treeitem"][aria-level="1"]');
}

/** The node id behind a row, from its `tree-node-{id}` testid. */
export async function rowNodeId(row: Locator): Promise<string | null> {
  const testId: string | null = await row.getAttribute('data-testid');
  return testId?.startsWith('tree-node-') ? testId.slice('tree-node-'.length) : null;
}

/** Click a row and wait until it is the selection. Returns its node id, or null if it never became selected. */
async function selectRow(row: Locator): Promise<string | null> {
  if (!(await isVisibleWithin(row, STEP_TIMEOUT_MS))) return null;
  await row.click();
  if (!(await isVisibleWithin(row.and(row.page().locator('[aria-selected="true"]')), STEP_TIMEOUT_MS))) return null;
  return rowNodeId(row);
}

async function closeFilter(page: Page): Promise<void> {
  const toggle: Locator = page.getByTestId('tree-search-toggle');
  if ((await toggle.getAttribute('aria-expanded').catch(() => null)) === 'true') {
    await toggle.click();
    await isHiddenWithin(page.getByTestId('tree-search-input'), STEP_TIMEOUT_MS);
  }
}

/**
 * Where `nodeName` lives, as the names from the workspace root down to its
 * parent (empty for the root itself). Null when the filter answers that no node
 * has that exact name. Throws when the filter could not be asked at all, so an
 * absent filter is never read as an absent node.
 */
export async function findNodePath(page: Page, nodeName: string): Promise<string[] | null> {
  const toggle: Locator = page.getByTestId('tree-search-toggle');
  if (!(await isVisibleWithin(toggle, STEP_TIMEOUT_MS))) {
    // The filter is offered only when there is something to filter.
    if (await page.getByTestId('tree-empty').isVisible()) return null;
    throw new Error('The hierarchy filter is not on screen');
  }
  // Start from a closed filter: results of an earlier query fade out after a
  // new one renders, and must not be read as its answer.
  await closeFilter(page);
  await toggle.click();
  const input: Locator = page.getByTestId('tree-search-input');
  await input.fill(nodeName);
  const answered: Locator = page.getByTestId('tree-search-results').or(page.getByTestId('tree-search-empty'));
  if (!(await isVisibleWithin(answered.first(), STEP_TIMEOUT_MS))) {
    await closeFilter(page);
    throw new Error(`The hierarchy filter did not answer for "${nodeName}"`);
  }
  const showAll: Locator = page.getByTestId('tree-search-show-all');
  if (await showAll.isVisible()) await showAll.click();
  const titles: string[] = await page
    .locator('[data-testid="tree-search-results"] [data-testid^="tree-search-result-"]')
    .evaluateAll((buttons: Element[]) => buttons.map((b: Element) => b.getAttribute('title') ?? ''));
  await closeFilter(page);
  const match: string[] | undefined = titles
    .map((title: string) => title.split(PATH_SEPARATOR))
    .find((segments: string[]) => segments[segments.length - 1] === nodeName);
  return match ? match.slice(0, -1) : null;
}

/** Click down `path` (root first) and then `nodeName`. Returns the node's id, or null if a step failed. */
async function walkTo(page: Page, path: string[], nodeName: string): Promise<string | null> {
  const rootId: string | null = await selectRoot(page);
  if (rootId === null) return null;
  if (path.length === 0) return rootId;
  for (let i = 1; i < path.length; i++) {
    if ((await selectRow(treeRow(page, path[i], i + 1).first())) === null) {
      console.log(`  [Tree] Could not select "${path[i]}" on the way to "${nodeName}"`);
      return null;
    }
  }
  return selectRow(treeRow(page, nodeName, path.length + 1).first());
}

/**
 * Bring `nodeName` on screen by selecting it, and return its node id. Retries
 * until `timeout`, because a node just created round-trips to the server before
 * the sidebar knows about it. Null when it never appeared.
 */
export async function revealNode(page: Page, nodeName: string, timeout = 10_000): Promise<string | null> {
  const deadline: number = Date.now() + timeout;
  do {
    const onScreen: Locator = treeRow(page, nodeName).first();
    if (await onScreen.isVisible()) {
      const id: string | null = await selectRow(onScreen);
      if (id !== null) return id;
    }
    const path: string[] | null = await findNodePath(page, nodeName);
    if (path !== null) {
      const id: string | null = await walkTo(page, path, nodeName);
      if (id !== null) {
        console.log(`  [Tree] Revealed "${nodeName}" (${[...path, nodeName].join(PATH_SEPARATOR)})`);
        return id;
      }
    }
    await sleep(RETRY_INTERVAL_MS);
  } while (Date.now() < deadline);
  console.log(`  [Tree] "${nodeName}" could not be revealed`);
  return null;
}

/** Whether the workspace has no node named `nodeName`, waiting up to `timeout` for one to go. */
export async function nodeAbsentFromWorkspace(page: Page, nodeName: string, timeout = 10_000): Promise<boolean> {
  const deadline: number = Date.now() + timeout;
  do {
    if ((await findNodePath(page, nodeName)) === null && !(await treeRow(page, nodeName).first().isVisible())) return true;
    await sleep(RETRY_INTERVAL_MS);
  } while (Date.now() < deadline);
  return false;
}

/** Select the workspace root. Returns its id, or null if it never became selected. */
export async function selectRoot(page: Page): Promise<string | null> {
  return selectRow(rootRow(page));
}

/** Open the ⋯ menu of the node whose id is `nodeId`, which must be on a sibling row. */
async function openMenuOf(page: Page, nodeId: string): Promise<string | null> {
  // Not forced: force skips Playwright's stability wait, and a row that was
  // just selected is still gliding -- the click lands where the trigger was.
  // (opacity-0 until hover does not need force; Playwright counts it visible.)
  await page.getByTestId(`tree-node-menu-${nodeId}`).click({ timeout: STEP_TIMEOUT_MS });
  return (await isVisibleWithin(page.locator('[role="menu"]'), STEP_TIMEOUT_MS)) ? nodeId : null;
}

/** Open the ⋯ menu of `nodeName`, revealing it first. Returns its node id, or null. */
export async function openNodeMenu(page: Page, nodeName: string): Promise<string | null> {
  const nodeId: string | null = await revealNode(page, nodeName);
  // The selected node is a sibling row, and sibling rows carry the menu.
  return nodeId === null ? null : openMenuOf(page, nodeId);
}

/** Open the ⋯ menu of whichever node is selected. Returns its node id, or null. */
export async function openSelectedNodeMenu(page: Page): Promise<string | null> {
  const selected: Locator = hierarchyTree(page).locator('[role="treeitem"][aria-selected="true"]');
  if (!(await isVisibleWithin(selected, STEP_TIMEOUT_MS))) return null;
  const nodeId: string | null = await rowNodeId(selected);
  return nodeId === null ? null : openMenuOf(page, nodeId);
}

/**
 * Put a peek chevron on screen and return it, or null when the workspace has
 * none to offer. A chevron sits on a peer of the selection that has children,
 * so this selects each top-level node in turn until one of its peers has some.
 */
export async function revealPeekToggle(page: Page): Promise<Locator | null> {
  if ((await selectRoot(page)) === null) return null;
  const topLevel: string[] = await hierarchyTree(page)
    .locator('[role="treeitem"][aria-level="2"][data-testid^="tree-node-"]')
    .evaluateAll((rows: Element[]) => rows.map((row: Element) => row.getAttribute('aria-label') ?? ''));
  const toggle: Locator = hierarchyTree(page).locator('[data-testid^="tree-node-toggle-"]').first();
  for (const name of topLevel.filter((n: string) => n !== '')) {
    if ((await revealNode(page, name, STEP_TIMEOUT_MS)) === null) continue;
    if (await isVisibleWithin(toggle, 2000)) return toggle;
  }
  return null;
}
