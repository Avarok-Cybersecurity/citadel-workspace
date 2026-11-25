import { strict as assert } from 'node:assert';

/**
 * Where the event form sits (owner, 2026-11-25): editing an event drew the form at the top and the
 * Calendar's own bar (Today, the month, the views, + New) below it. The form now replaces the
 * calendar, as every other panel the pane opens does, behind "Back to the calendar". Checked for a
 * new event (scenario `calendar-mounted`) and an edited one (scenario `calendar-changes`): the bar is
 * seen first, so its test id is known to match; with the form open no bar is drawn below the form's
 * top; the back control is above the form; and going back shows the bar again.
 */
async function toolbarBoxes(page) {
  return page.getByTestId('calendar-toolbar').evaluateAll((nodes) => nodes
    .filter((n) => n.getClientRects().length > 0)
    .map((n) => n.getBoundingClientRect().toJSON()));
}

async function formIsAlone(page, what) {
  const form = await page.getByTestId('calendar-event-editor').boundingBox();
  assert.ok(form !== null, `${what}: the form is not drawn`);
  const below = (await toolbarBoxes(page)).filter((t) => t.bottom > form.y + 0.5);
  assert.deepEqual(below.map((t) => `${Math.round(t.top)}px`), [], `${what}: the calendar's bar is drawn below the form's top (${Math.round(form.y)}px)`);
  const back = await page.getByRole('button', { name: 'Back to the calendar' }).boundingBox();
  assert.ok(back !== null && back.y + back.height <= form.y + 0.5, `${what}: "Back to the calendar" is not above the form`);
  await page.getByRole('button', { name: 'Back to the calendar' }).click();
  await page.getByTestId('calendar-toolbar').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('calendar-event-editor').count(), 0, `${what}: the form stayed after going back`);
}

async function seeTheBar(page, url, viewport, scenario) {
  await page.setViewportSize({ width: viewport.width < 600 ? 375 : viewport.width, height: viewport.height });
  await page.goto(url(scenario));
  await page.getByTestId('calendar-toolbar').waitFor({ state: 'visible' });
  assert.equal((await toolbarBoxes(page)).length, 1, 'the calendar did not draw its bar before the form opened');
}

async function aNewEventsFormReplacesTheCalendar({ page, url, viewport }) {
  await seeTheBar(page, url, viewport, 'calendar-mounted');
  await page.getByRole('button', { name: 'New', exact: true }).first().click();
  await page.getByTestId('calendar-event-editor').waitFor({ state: 'visible' });
  await formIsAlone(page, 'a new event');
}

async function anEditedEventsFormReplacesTheCalendar({ page, url, viewport }) {
  await seeTheBar(page, url, viewport, 'calendar-changes');
  await page.getByRole('button', { name: /Quarterly review/ }).first().click();
  await page.getByRole('button', { name: 'Edit event' }).click();
  await page.getByTestId('calendar-event-editor').waitFor({ state: 'visible' });
  await formIsAlone(page, 'an edited event');
}

export const CALENDAR_FORM_PLACE_CHECKS = { aNewEventsFormReplacesTheCalendar, anEditedEventsFormReplacesTheCalendar };
