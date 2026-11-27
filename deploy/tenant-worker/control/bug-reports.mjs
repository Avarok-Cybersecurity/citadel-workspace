/**
 * `POST /api/bug-reports`: a problem report from the app (RECOVERY-DESIGN.md §3.5), answered
 *
 *   201 { id }            stored for 90 days; the id is what the person quotes to Avarok
 *   400 malformed-report  not a format-1 report (bug-report-shape.mjs)
 *   413 too-large         over 96 KiB
 *   422 still-sensitive   a field still carries a shape that must not be stored (bug-report-scan.mjs)
 *   429 rate-limited      more than REPORTS_PER_HOUR from one address this hour
 *
 * Same-origin JSON only (readJson). The tenant is always recorded (owner decision 1): resolved
 * here from the workspace server the report names, never taken as a slug on the client's word.
 * The account is recorded only as the `contact` the person ticked to give.
 */
import { json, readJson, refuse } from "./http.mjs";
import { sha256Hex, toHex } from "./secrets.mjs";
import { checkSlug } from "./slug.mjs";
import { MAX_REPORT_BYTES, readReport } from "./bug-report-shape.mjs";
import { firstLeak } from "./bug-report-scan.mjs";

export const REPORTS_PER_HOUR = 5;
const ATTEMPT_LABEL = "citadel-bug-report-attempt:";
const ALWAYS_SAID = new Set();

/** `br_` and 24 hex characters: random, so an id says nothing about when or whose. */
const reportId = (io) => `br_${toHex(io.random(12))}`;
/** What `reportId` makes: support's reads (support.mjs) look up nothing else. */
export const REPORT_ID = /^br_[0-9a-f]{24}$/;

async function tenantOf(io, cfg, report) {
  const host = report.context.find((item) => item.key === "tenant")?.value;
  if (typeof host !== "string" || host === "none") return null;
  const name = host.toLowerCase().split(":")[0];
  if (name.endsWith(`.${cfg.controlHost}`)) {
    const slug = name.slice(0, -(cfg.controlHost.length + 1));
    return checkSlug(slug).ok ? slug : null;
  }
  return io.store.slugForDomain(name);
}

export async function receiveBugReport(io, cfg, request) {
  const read = await readJson(request, cfg, MAX_REPORT_BYTES);
  if (read.error) return read.error;
  const { report, refusal } = readReport(read.value);
  if (refusal) return refuse("malformed-report", refusal, 400);
  const tenantIndex = report.context.findIndex((item) => item.key === "tenant");
  const allowed = tenantIndex === -1 ? ALWAYS_SAID : new Set([`context[${tenantIndex}]`]);
  const leak = firstLeak(report, allowed);
  if (leak !== null) return refuse("still-sensitive", `${leak.field} looks like a ${leak.rule}`, 422);

  const nowMs = io.nowMs();
  const hour = Math.floor(nowMs / 3_600_000);
  const ip = request.headers.get("cf-connecting-ip");
  if ((await io.bugReports.countAttempt(await sha256Hex(`${ATTEMPT_LABEL}${ip ?? ""}`), hour)) > REPORTS_PER_HOUR) {
    return refuse("rate-limited", `at most ${REPORTS_PER_HOUR} reports an hour`, 429);
  }
  const id = reportId(io);
  const tenant = await tenantOf(io, cfg, report);
  await io.bugReports.insert({ id, tenant, surface: report.surface, contact: report.contact, body: JSON.stringify(report) }, nowMs);
  return json({ id }, 201);
}
