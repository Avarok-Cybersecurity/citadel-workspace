/**
 * The server's second look at a problem report (RECOVERY-DESIGN.md §3.3): the client redacts
 * before the person previews, and this refuses a report whose text still carries a shape that must
 * never be stored -- a URL, an address, a file name, a key-like run, a long number, a phrase.
 *
 * The shapes are the client's (citadel-workspaces/src/lib/bug-report/redact.ts REDACTION_RULES);
 * test/bug-report-scan.test.mjs holds the two lists equal. A redaction placeholder (`<url>`) is
 * not a match: none of the shapes can match one.
 */
export const SCAN_RULES = [
  { name: "url", source: String.raw`\b(?:https?|wss?):\/\/[^\s"'<>]+` },
  { name: "email", source: String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}` },
  { name: "file", source: String.raw`[^\s"'/\\<>]+\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|txt|md|rtf|csv|png|jpe?g|gif|webp|heic|svg|zip|tar|gz|mp3|mp4|mov|wav|key|pages|numbers|cdoc)\b` },
  { name: "token", source: String.raw`[A-Za-z0-9+/_=-]{24,}` },
  { name: "id", source: String.raw`\b\d{10,}\b` },
  { name: "phrase", source: String.raw`\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b` },
];

const COMPILED = SCAN_RULES.map((rule) => ({ name: rule.name, pattern: new RegExp(rule.source, "u") }));

/** Fields whose text is scanned: everything a person or the page wrote. */
function textsOf(report) {
  const texts = [["note", report.note]];
  report.console.forEach((line, i) => {
    texts.push([`console[${i}]`, line.message]);
    if (line.stack !== null) texts.push([`console[${i}].stack`, line.stack]);
  });
  report.context.forEach((item, i) => texts.push([`context[${i}]`, item.value]));
  return texts;
}

/** The first field still carrying a forbidden shape, as `{ field, rule }`, or null when clean. */
export function firstLeak(report, allowedContexts) {
  for (const [field, text] of textsOf(report)) {
    // The workspace server's host is said on purpose (owner decision 1); so is the contact handle.
    if (allowedContexts.has(field)) continue;
    for (const { name, pattern } of COMPILED) if (pattern.test(text)) return { field, rule: name };
  }
  return null;
}
