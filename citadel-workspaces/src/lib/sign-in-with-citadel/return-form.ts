/**
 * The return port: `ReturnPost` (sign-in-with-citadel.md §1 step 3) as an auto-submitted form,
 * `application/x-www-form-urlencoded`, so the code travels in a POST body and never in a URL.
 */
import type { ReturnPort } from './ports';

export function formReturner(doc: Document): ReturnPort {
  return {
    post(action: string, fields: { code: string; state: string }): void {
      const form: HTMLFormElement = doc.createElement('form');
      form.method = 'POST';
      form.action = action;
      form.enctype = 'application/x-www-form-urlencoded';
      form.hidden = true;
      for (const [name, value] of Object.entries(fields)) {
        const input: HTMLInputElement = doc.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      doc.body.appendChild(form);
      form.submit();
    },
  };
}
