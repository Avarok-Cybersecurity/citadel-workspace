/**
 * What an apps refusal says beyond its ways out: the ways out are its surface's plan
 * (recovery-route/surfaces/apps.ts), drawn by RecoveryNotice. This holds what that plan's
 * ask-admin sends, and the line someone who manages apps is told about `Unavailable`.
 *
 * `Unavailable` stays one answer for "does not exist" and "not for you". Someone who manages apps
 * (`AppManage` on the workspace) may see every listing anyway, so they are told what the answer
 * can mean; nobody is told which it was. Pure.
 */
import type { AppsFailure } from '@/lib/workspace-service/apps-operations';

export const UNAVAILABLE_FOR_MANAGERS: string =
  'The server says this when the app is no longer offered to you here, or the page you chose is not there. Choose another page, or report it.';

/** The managers' line for `refusal`, for a person who does (`manages`) or does not manage apps here. */
export const managersLine = (refusal: AppsFailure, manages: boolean): string | null =>
  manages && refusal === 'Unavailable' ? UNAVAILABLE_FOR_MANAGERS : null;

export interface RefusedInstall {
  appName: string;
  version: string;
  /** Where it was to be installed, in words (scope-sentence.ts). */
  where: string;
  /** The link that opens this app's listing (app-link.ts `appLinkUrl`). */
  link: string;
  /** The refusal in words (refusal-copy.ts). */
  copy: string;
}

/** What the admins are asked about (admin-requests/words.ts frames it): the app, the place, its link, the answer. */
export const adminAskAbout = (r: RefusedInstall): string =>
  `${r.appName} ${r.version} for ${r.where} (${r.link}). When I tried, it said: ${r.copy}`;
