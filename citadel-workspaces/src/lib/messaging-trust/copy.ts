/** What the messaging trust settings say. One place, so both screens and the specs agree. */
import type { PersonalTrustChoice, WorkspaceTrustChoice } from './trust-choice';

export interface ChoiceCopy {
  label: string;
  detail: string;
}

export const WORKSPACE_TRUST_COPY: Record<WorkspaceTrustChoice, ChoiceCopy> = {
  AllTrusted: {
    label: 'Everyone in the workspace',
    detail: 'Members connect with each other as soon as one opens a chat. No requests to accept.',
  },
  NodeLevelTrusted: {
    label: 'Only within a node',
    detail: 'People in the chosen node and the nodes below it connect automatically; anyone else sends a request.',
  },
  Strict: {
    label: 'Ask every time',
    detail: 'Every connection is a request the other person accepts.',
  },
};

export const PERSONAL_TRUST_COPY: Record<PersonalTrustChoice, ChoiceCopy> = {
  follow: {
    label: 'Follow the workspace',
    detail: 'Whatever your workspace admins chose.',
  },
  node: {
    label: 'Only within a node',
    detail: 'People in the chosen node and below connect with you automatically; others ask first.',
  },
  ask: {
    label: 'Ask me every time',
    detail: 'You accept every connection yourself.',
  },
};

export const TRUST_SECTION_COPY: {
  workspaceTitle: string;
  workspaceHint: string;
  personalTitle: string;
  personalHint: string;
  nodePickerLabel: string;
  nodePickerPlaceholder: string;
  noNodes: string;
  adminsOnly: string;
  workspaceIsStrict: string;
} = {
  workspaceTitle: 'Messaging trust',
  workspaceHint: 'Who connects with each other without a connect request.',
  personalTitle: 'Who connects with me automatically',
  personalHint: 'You can only make this stricter than your workspace. Anyone outside it is governed by the setting above.',
  nodePickerLabel: 'Node',
  nodePickerPlaceholder: 'Choose a node',
  noNodes: 'There are no nodes to choose from.',
  adminsOnly: 'Only workspace admins can change this.',
  workspaceIsStrict: 'Your workspace asks every time, so there is nothing to narrow.',
};
