/** Shapes that must never leave in a report, and text that must survive redaction intact. */
import { describe, expect, it } from 'vitest';
import { redactText, routeTemplate } from '../redact';

describe('redactText', () => {
  it.each([
    ['fetch https://acme.example/api?token=abc failed', 'fetch <url> failed'],
    ['ws closed: wss://local.avarok.net:8443/x#k=1', 'ws closed: <url>'],
    ['mail bob@example.org now', 'mail <email> now'],
    ['could not open Q3 budget.xlsx', 'could not open Q3 <file>'],
    ['key AAAAB3NzaC1yc2EAAAADAQABAAABAQ== bad', 'key <redacted> bad'],
    ['peer 18446744073709551615 offline', 'peer <id> offline'],
    ['abandon ability able about above absent absorb abstract absurd abuse access accident', '<redacted>'],
  ])('%s', (input: string, output: string) => {
    expect(redactText(input)).toBe(output);
  });

  it('ordinary diagnostic text is left as it was', () => {
    const line: string = 'TypeError: Cannot read properties of undefined (reading \'map\') at render (App.tsx:12)';
    expect(redactText(line)).toBe(line);
  });
});

describe('routeTemplate', () => {
  it('keeps the first segment and hides the rest, with no query', () => {
    expect(routeTemplate('/workspace/office-7/room-3')).toBe('/workspace/:id/:id');
    expect(routeTemplate('/')).toBe('/');
  });
});
