/**
 * Turning encryption at rest on and off converts an account's records on this device in place:
 * every kind (document copy, held edits, choices, the kept edit answer, the kept tree), sealed
 * so none holds its text, and opened back to exactly what was kept. A conversion cut short
 * leaves every record readable and is finished on the next page; turning it on is refused,
 * with nothing changed, when the agent cannot keep the root.
 *
 * Doubles only at the two I/O edges (doubles/device-records.ts): the browser's store and the
 * agent's root store. The seam, sweeps, cryptography and readers are production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT_REST_REFUSED_UNREACHABLE } from '../at-rest-copy';
import { isAtRestEnvelope } from '../at-rest-shape';
import { agent, device, resetDoubles, storedAnywhere } from './doubles/device-records';
import { ACCOUNT, EVERYTHING, NODE, TOKEN, keepEverything, page, readEverything, type Page } from './doubles/kept-records';

vi.mock('@/lib/storage-utils', async () => (await import('./doubles/device-records')).browserStore());

const MODE_KEY: string = `cdoc-collab:${ACCOUNT.toString()}:#at-rest`;
const records = (): [string, unknown][] => [...device.records.entries()].filter(([key]: [string, unknown]): boolean => key !== MODE_KEY);
const allSealed = (): boolean => records().every(([, value]: [string, unknown]): boolean => isAtRestEnvelope(value));
const noneSealed = (): boolean => records().every(([, value]: [string, unknown]): boolean => !isAtRestEnvelope(value));

beforeEach((): void => { resetDoubles(); });

describe('turning encryption on', () => {
  it('seals every record in place, so none holds its text, and each reads back as it was', async () => {
    const p: Page = await page();
    await keepEverything(p);
    expect(storedAnywhere(TOKEN)).toBe(true);

    await p.seam.setDocumentsAtRest(ACCOUNT, true);
    expect(records()).toHaveLength(5);
    expect(allSealed()).toBe(true);
    expect(storedAnywhere(TOKEN)).toBe(false);
    expect(device.records.get(MODE_KEY)).toEqual({ on: true, converting: false });
    expect(await readEverything(p)).toEqual(EVERYTHING);
    // A new page, with nothing in memory: the key comes back from the agent's root.
    expect(await readEverything(await page())).toEqual(EVERYTHING);
  });

  it('seals every later write, each with a nonce of its own', async () => {
    const p: Page = await page();
    await p.seam.setDocumentsAtRest(ACCOUNT, true);
    await keepEverything(p);
    expect(allSealed()).toBe(true);
    expect(storedAnywhere(TOKEN)).toBe(false);

    const ivOf = (): string => Array.from((device.records.get(`cdoc-collab:${ACCOUNT.toString()}:${NODE}#device`) as { iv: Uint8Array }).iv).join(',');
    const first: string = ivOf();
    await p.cache.saveChoices(NODE, { autoSave: false });
    expect(ivOf()).not.toBe(first);
  });

  it('is refused, with nothing changed, while the agent does not answer', async () => {
    const p: Page = await page();
    await keepEverything(p);
    agent.reachable = false;
    await expect(p.seam.setDocumentsAtRest(ACCOUNT, true)).rejects.toThrow(AT_REST_REFUSED_UNREACHABLE);
    expect(device.records.has(MODE_KEY)).toBe(false);
    expect(noneSealed()).toBe(true);
    expect(await p.seam.documentsAtRest(ACCOUNT)).toBe(false);
  });

  it('is refused, with nothing changed, when the agent answers a root it did not keep', async () => {
    const p: Page = await page();
    await keepEverything(p);
    agent.losesWrites = true;
    await expect(p.seam.setDocumentsAtRest(ACCOUNT, true)).rejects.toThrow(AT_REST_REFUSED_UNREACHABLE);
    expect(device.records.has(MODE_KEY)).toBe(false);
    expect(noneSealed()).toBe(true);
  });

  it('cut short, leaves every record readable, and the next page finishes it', async () => {
    const p: Page = await page();
    await keepEverything(p);
    device.crashAfter = 2;
    await expect(p.seam.setDocumentsAtRest(ACCOUNT, true)).rejects.toThrow('the tab closed mid-conversion');
    expect(records().filter(([, value]: [string, unknown]): boolean => isAtRestEnvelope(value))).toHaveLength(2);
    expect(await readEverything(p)).toEqual(EVERYTHING);

    device.crashAfter = null;
    const next: Page = await page();
    await readEverything(next);
    await vi.waitFor((): void => { expect(device.records.get(MODE_KEY)).toEqual({ on: true, converting: false }); });
    expect(allSealed()).toBe(true);
    expect(storedAnywhere(TOKEN)).toBe(false);
    expect(await readEverything(next)).toEqual(EVERYTHING);
  });
});

describe('a write that lands while its record is converted', () => {
  it('is neither lost nor left plain: the next page seals it', async () => {
    const p: Page = await page();
    await keepEverything(p);
    const choices: string = `cdoc-collab:${ACCOUNT.toString()}:${NODE}#device`;
    device.writeFirst = { key: choices, value: { autoSave: true } };
    await p.seam.setDocumentsAtRest(ACCOUNT, true);
    expect(device.records.get(choices)).toEqual({ autoSave: true });
    expect(device.records.get(MODE_KEY)).toEqual({ on: true, converting: true });

    const next: Page = await page();
    expect(await next.cache.loadChoices(NODE)).toEqual({ autoSave: true });
    await vi.waitFor((): void => { expect(device.records.get(MODE_KEY)).toEqual({ on: true, converting: false }); });
    expect(isAtRestEnvelope(device.records.get(choices))).toBe(true);
    expect(await next.cache.loadChoices(NODE)).toEqual({ autoSave: true });
  });
});

describe('turning encryption off', () => {
  it('opens every record in place, and each reads back as it was', async () => {
    const p: Page = await page();
    await keepEverything(p);
    await p.seam.setDocumentsAtRest(ACCOUNT, true);
    await p.seam.setDocumentsAtRest(ACCOUNT, false);
    expect(noneSealed()).toBe(true);
    expect(device.records.get(MODE_KEY)).toEqual({ on: false, converting: false });
    expect(await readEverything(await page())).toEqual(EVERYTHING);
  });

  it('cut short, leaves every record readable, and the next page finishes it', async () => {
    const p: Page = await page();
    await keepEverything(p);
    await p.seam.setDocumentsAtRest(ACCOUNT, true);
    device.replaced = 0;
    device.crashAfter = 3;
    await expect(p.seam.setDocumentsAtRest(ACCOUNT, false)).rejects.toThrow('the tab closed mid-conversion');
    expect(records().filter(([, value]: [string, unknown]): boolean => !isAtRestEnvelope(value))).toHaveLength(3);
    expect(await readEverything(p)).toEqual(EVERYTHING);

    device.crashAfter = null;
    const next: Page = await page();
    await readEverything(next);
    await vi.waitFor((): void => { expect(device.records.get(MODE_KEY)).toEqual({ on: false, converting: false }); });
    expect(noneSealed()).toBe(true);
    expect(await readEverything(next)).toEqual(EVERYTHING);
  });
});
