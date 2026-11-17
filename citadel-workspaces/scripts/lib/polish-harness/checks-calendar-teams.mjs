import { strict as assert } from 'node:assert';
import { fitsAndReads } from './checks-calendar-panels.mjs';

/**
 * Team bookings, polls and routing forms from the UI (scenario `calendar-teams`). Each screen fits
 * at 375px and on a desktop with 44px targets and axe clean: the team-type editor, a round robin's
 * and a collective's booking page, the routing form, the polls and a new poll. And what the
 * controls write: a team type and a routing form saved on the node; a round-robin booking left for bo, who has fewer
 * bookings this month than ana (the first by name); a vote in the voter's own namespace; the host's
 * pick turning their poll into an event; and a routing answer opening the page it routes to.
 */
async function opened(page, url, viewport, button) {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  await page.goto(url('calendar-teams'));
  await page.getByTestId('calendar-tab').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: button, exact: true }).click();
  return width;
}

const keysLike = (page, prefix) => page.evaluate((p) => window.__calendarKeys().filter((k) => k.startsWith(p)), prefix);

async function theTeamTypeEditorFitsAndSaves({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Your booking page');
  const section = page.getByTestId('calendar-team-types');
  await section.getByRole('button', { name: 'New team type' }).click();
  await section.getByLabel('Name').fill('Interviews');
  await section.getByLabel('ana', { exact: true }).check();
  await section.getByLabel('bo', { exact: true }).check();
  await section.getByLabel(/By priority/).check();
  await fitsAndReads(page, width, 'the team-type editor');
  await section.getByRole('button', { name: 'Save event type' }).click();
  await section.getByText(/Give each host a weight/).first().waitFor({ state: 'visible', timeout: 5000 });
  await section.getByRole('group', { name: /Weights/ }).getByLabel('ana').fill('3');
  await section.getByRole('group', { name: /Weights/ }).getByLabel('bo').fill('1');
  await section.getByRole('button', { name: 'Save event type' }).click();
  await section.getByText('Saved Interviews.').waitFor({ state: 'visible', timeout: 5000 });
  const saved = [];
  for (const key of await keysLike(page, 'node:n1|cal/type/')) saved.push(await page.evaluate((k) => window.__calendarRead('decodeEventType', k), key));
  const made = saved.find((t) => t.name === 'Interviews');
  assert.deepEqual(made?.kind, { round_robin: { hosts: ['ana', 'bo'], strategy: { priority: { weights: [['ana', 3], ['bo', 1]] } } } });
}

async function chooseATime(page) {
  await page.getByRole('group', { name: 'Days with free times' }).getByRole('button').first().click();
  await page.getByTestId('calendar-slot').first().click();
}

async function aRoundRobinGoesToTheHostWithFewerBookings({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Book with someone');
  await page.getByRole('button', { name: 'Support rota', exact: true }).click();
  await page.getByRole('heading', { name: 'Book with Support rota' }).waitFor({ state: 'visible' });
  await chooseATime(page);
  await fitsAndReads(page, width, "a round robin's booking page");
  await page.getByTestId('calendar-confirm-booking').click();
  await page.getByTestId('calendar-booking-said').getByText(/^Requested/).waitFor({ state: 'visible', timeout: 5000 });
  const [key] = await keysLike(page, 'authored:n1:alice|cal/booking/');
  assert.ok(key !== undefined, 'no booking request was written');
  const booking = await page.evaluate((k) => window.__calendarRead('decodeBooking', k), key);
  assert.equal(booking.host, 'bo', `the round robin went to ${booking.host}, not bo, who has fewer bookings this month`);
}

async function aCollectiveBookingPageFits({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Book with someone');
  await page.getByRole('button', { name: 'Panel interview', exact: true }).click();
  await page.getByRole('heading', { name: 'Book with Panel interview' }).waitFor({ state: 'visible' });
  await chooseATime(page);
  await fitsAndReads(page, width, "a collective's booking page");
}

async function aRoutingAnswerOpensThePageItRoutesTo({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Book with someone');
  const form = page.getByTestId('calendar-routing-form');
  await form.getByLabel(/What is it about/).selectOption('Sales');
  await fitsAndReads(page, width, 'the routing form');
  await form.getByRole('button', { name: 'Find whom to book' }).click();
  await page.getByRole('heading', { name: 'Book with bo' }).waitFor({ state: 'visible', timeout: 5000 });
  await form.getByLabel(/What is it about/).selectOption('Support');
  await form.getByRole('button', { name: 'Find whom to book' }).click();
  await page.getByRole('heading', { name: 'Book with Support rota' }).waitFor({ state: 'visible', timeout: 5000 });
}

/** A routing form made in its editor, a rule moved above another, is saved as it was left. */
async function aRoutingFormIsMadeInItsEditor({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Your booking page');
  const editor = page.getByTestId('calendar-routing-forms');
  await editor.getByRole('button', { name: 'New routing form' }).click();
  await editor.getByLabel('Form name').fill('Triage');
  await editor.getByRole('button', { name: 'Add a question' }).click();
  await editor.getByLabel('Question 1', { exact: true }).fill('Which team?');
  await editor.getByLabel('Question 1 answer').selectOption('choice');
  await editor.getByLabel('Question 1 options, one per line').fill('Sales\nSupport');
  await editor.getByRole('button', { name: 'Add a rule' }).click();
  await editor.getByRole('button', { name: 'Add a rule' }).click();
  const rules = editor.getByTestId('calendar-routing-rule');
  await rules.nth(0).getByLabel('Sales', { exact: true }).check();
  await rules.nth(0).getByLabel('Rule 1 sends the booker to: member').selectOption('bo');
  await rules.nth(1).getByLabel('Support', { exact: true }).check();
  await rules.nth(1).getByLabel('Rule 2 sends the booker to: kind').selectOption('team_type');
  await rules.nth(1).getByLabel('Rule 2 sends the booker to: team type').selectOption('rr');
  await rules.nth(1).getByRole('button', { name: 'Move rule 2 up' }).click();
  await editor.getByLabel('Anyone else goes to: kind').selectOption('node');
  await editor.getByLabel('Anyone else goes to: node id').fill('company');
  await fitsAndReads(page, width, 'the routing-form editor');
  await editor.getByRole('button', { name: 'Save routing form' }).click();
  await editor.getByText('Saved Triage.').waitFor({ state: 'visible', timeout: 5000 });
  const forms = [];
  for (const key of await keysLike(page, 'node:n1|cal/routing/')) forms.push(await page.evaluate((k) => window.__calendarTeam('decodeRoutingForm', k), key));
  const made = forms.find((f) => f.name === 'Triage');
  assert.deepEqual(made?.rules.map((r) => r.target), [{ team_type: { node_id: 'n1', type_id: 'rr' } }, { member: { username: 'bo', slug: 'n1' } }]);
  assert.deepEqual(made?.fallback, { node: { node_id: 'company' } });
}

async function aVoteAndAPickAreSavedFromThePolls({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Polls');
  const offsite = page.getByTestId('calendar-poll').filter({ hasText: 'Offsite planning' });
  await offsite.getByRole('listitem').nth(1).getByText('Yes', { exact: true }).click();
  await fitsAndReads(page, width, 'the polls');
  await offsite.getByRole('button', { name: 'Save my vote' }).click();
  await offsite.getByText('Your vote is saved.').waitFor({ state: 'visible', timeout: 5000 });
  const vote = await page.evaluate(() => window.__calendarTeam('decodePollVote', 'authored:n1:alice|cal/poll-vote/pa'));
  assert.deepEqual({ yes: vote.yes, maybe: vote.maybe }, { yes: [1], maybe: [] });
  const retro = page.getByTestId('calendar-poll').filter({ hasText: 'Retro' });
  await retro.getByRole('listitem').nth(1).getByRole('button', { name: 'Pick this time' }).click();
  await retro.getByText(/^Picked /).first().waitFor({ state: 'visible', timeout: 5000 });
  const poll = await page.evaluate(() => window.__calendarTeam('decodePoll', 'authored:n1:alice|cal/poll/pv'));
  assert.equal(poll.state.picked?.proposal, 1, 'the pick did not mark the poll');
  const made = await page.evaluate((id) => window.__calendarRead('decodeEvent', `authored:n1:alice|cal/event/${id}`), poll.state.picked.event_id);
  assert.deepEqual(made.invitees, [{ member: { username: 'bo' } }], 'the picked event does not invite who said yes');
}

async function aNewPollFits({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Polls');
  await page.getByRole('button', { name: 'New poll' }).click();
  await page.getByTestId('calendar-poll-composer').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Add a time' }).click();
  await fitsAndReads(page, width, 'a new poll');
}

/**
 * The member's notification settings fit with 44px targets, light and dark, and each change is
 * saved to their own storage as it is made; turned off, every option is stilled.
 */
async function theNotificationSettingsFitAndSave({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Notifications');
  const form = page.getByTestId('calendar-notify-settings');
  await form.waitFor({ state: 'visible', timeout: 5000 });
  await fitsAndReads(page, width, 'the notification settings');
  await form.getByLabel(/^Bookings/).uncheck();
  await form.getByLabel('30 minutes before').check();
  await form.getByLabel(/^In Citadel only/).check();
  await page.getByTestId('calendar-notify-preview').getByText('Shown in the bell only.').waitFor({ state: 'visible', timeout: 5000 });
  const key = (await keysLike(page, 'user:')).find((k) => k.endsWith('cal/settings/notifications'));
  assert.ok(key !== undefined, 'the settings were not saved to the member');
  await form.getByRole('switch', { name: 'Calendar notifications' }).click();
  await page.getByText('You will not be reminded of your events.').waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await form.getByLabel(/^Invitations/).isDisabled(), 'an option stayed live with the Calendar turned off');
  await fitsAndReads(page, width, 'the notification settings, turned off');
}

/** The apps the viewer answered fit with 44px targets, and "Ask again" forgets an answer (design §3.8). */
async function theAppsUsingTheCalendarFit({ page, url, viewport }) {
  const width = await opened(page, url, viewport, 'Apps');
  const section = page.getByTestId('calendar-sdk-apps');
  await section.getByText('com.acme.spam · refused').waitFor({ state: 'visible', timeout: 5000 });
  await fitsAndReads(page, width, 'the apps using the calendar');
  await section.getByRole('button', { name: 'Ask com.acme.spam again' }).click();
  await section.getByText('com.acme.spam will be asked again.').waitFor({ state: 'visible', timeout: 5000 });
  const kept = await keysLike(page, 'user:');
  assert.ok(!kept.some((k) => k.endsWith('cal/sdk/allow/com.acme.spam')), 'the refusal was not forgotten');
  assert.ok(kept.some((k) => k.endsWith('cal/sdk/allow/com.acme.kanban')), 'the answer kept was forgotten too');
}

export const CALENDAR_TEAM_CHECKS = {
  theNotificationSettingsFitAndSave,
  theTeamTypeEditorFitsAndSaves, aRoundRobinGoesToTheHostWithFewerBookings, aCollectiveBookingPageFits,
  aRoutingAnswerOpensThePageItRoutesTo, aRoutingFormIsMadeInItsEditor, aVoteAndAPickAreSavedFromThePolls, aNewPollFits,
  theAppsUsingTheCalendarFit,
};
