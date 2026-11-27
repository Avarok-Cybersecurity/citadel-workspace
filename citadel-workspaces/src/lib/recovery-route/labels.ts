/**
 * The words on each route's control. A surface supplies only its message; the button text is
 * the route's, so "Try again" reads the same everywhere and no surface invents its own.
 */
import type { BrowserPermission, Destination, ManualRoute, WaitCondition } from './route';
import { RELOAD_LABEL } from './reload-label';

const DESTINATION_LABEL: { readonly [K in Destination]: string } = {
  connect: 'Go to Connect',
  home: 'Go to the start page',
  'apps-browse': 'See all apps',
  agent: 'Set up the Citadel agent',
};

const PERMISSION_LABEL: { readonly [K in BrowserPermission]: string } = {
  'loopback-network': 'Allow the local connection',
  notifications: 'Allow notifications',
  camera: 'Allow the camera',
  microphone: 'Allow the microphone',
  screen: 'Allow screen sharing',
  clipboard: 'Allow the clipboard',
  popups: 'Allow pop-ups',
  storage: 'Allow storage',
};

export const WAIT_LABEL: { readonly [K in WaitCondition]: string } = {
  'agent-online': 'Waiting for the Citadel agent',
  'agent-reconnect': 'Reconnecting to the Citadel agent',
  'server-reachable': 'Waiting for the server',
  'server-restart': 'Waiting for the server to restart',
  'network-online': 'Waiting for the network',
  'peer-online': 'Waiting for them to come online',
  'peer-accepts': 'Waiting for them to accept',
  'admin-decision': 'Waiting for an admin',
  'member-opens-app': 'Waiting for them to open it',
  'workspace-loaded': 'Waiting for the workspace to load',
  'schema-loaded': 'Waiting for the workspace layout to load',
};

/** The control's text. `name` is the member's name for contact-member, when the binding has one. */
export function routeLabel(route: ManualRoute, name: string | null): string {
  switch (route.kind) {
    case 'retry': return 'Try again';
    case 'reload': return RELOAD_LABEL;
    case 'apply-update': return 'Update now';
    case 'claim-session': return 'Use it here';
    case 'sign-in-again': return 'Sign in again';
    case 'fix-input': return 'Fix it';
    case 'open-setting': return 'Open settings';
    case 'navigate': return DESTINATION_LABEL[route.to];
    case 'ask-admin': return 'Ask an admin';
    case 'contact-member': return name === null ? 'Send a message' : `Message ${name}`;
    case 'install-agent': return route.reason === 'missing' ? 'Install the Citadel agent' : 'Update the Citadel agent';
    case 'grant-permission': return PERMISSION_LABEL[route.permission];
    case 'report-bug': return 'Report this problem';
    case 'acknowledge': return 'OK';
  }
}
