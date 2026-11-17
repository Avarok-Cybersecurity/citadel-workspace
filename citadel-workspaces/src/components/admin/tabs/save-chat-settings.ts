/**
 * Persisting a node's chat settings, separately from the tab that collects them.
 *
 * ChatSettingsTab used to carry the note "Chat settings backend API not yet
 * available", and acted on it: handleSave wrote nothing, showed a "Chat Settings
 * Updated" success toast, and cleared the dirty flag. The admin closed the dialog
 * believing chat was disabled for that office; nothing had changed, and reopening
 * the tab showed the old value with no explanation.
 *
 * The note was simply out of date. `UpdateNode` has carried both `chat_enabled`
 * and `rules` for some time, and `WorkspaceService.updateNode` already sends them
 * — the tab was the only piece never connected.
 *
 * One real limit remains, and it is a backend one: `UpdateWorkspace` has no chat
 * fields, so workspace-level chat settings cannot be stored. That case is refused
 * out loud rather than reported as saved.
 */

export interface ChatSettingsNotice {
  kind: 'success' | 'error';
  title: string;
  description: string;
}

export interface ChatSettingsUpdate {
  chatEnabled: boolean;
  rules: string;
}

export interface SaveChatSettingsDeps {
  /** 'workspace', or a node type such as 'office' / 'room'. */
  entityType: string;
  entityId: string;
  chatEnabled: boolean;
  chatRules: string;
  write: (nodeId: string, update: ChatSettingsUpdate) => Promise<unknown>;
  notify: (notice: ChatSettingsNotice) => void;
  log: (message: string, error?: unknown) => void;
}

/** Chat rules are stored in a node's `rules` column; keep it within one screen. */
export const MAX_CHAT_RULES_LENGTH: number = 2000;

/**
 * Returns whether the settings reached the server.
 *
 * The caller should treat the form as clean only when this is true — on any other
 * outcome the edits exist nowhere but the component's state.
 */
export async function saveChatSettings(deps: SaveChatSettingsDeps): Promise<boolean> {
  const { entityType, entityId, chatEnabled, chatRules, write, notify, log } = deps;

  if (entityType === 'workspace') {
    log('Refusing to save: UpdateWorkspace carries no chat fields');
    notify({
      kind: 'error',
      title: 'Not available for the workspace',
      description: 'Chat settings can be configured on offices and rooms, not on the workspace itself.',
    });
    return false;
  }

  if (!entityId) {
    log('Refusing to save: no entityId');
    notify({
      kind: 'error',
      title: 'Cannot save yet',
      description: 'This panel is still loading. Try again in a moment.',
    });
    return false;
  }

  if (chatRules.length > MAX_CHAT_RULES_LENGTH) {
    notify({
      kind: 'error',
      title: 'Chat rules are too long',
      description: `Rules must be ${MAX_CHAT_RULES_LENGTH} characters or fewer (currently ${chatRules.length}).`,
    });
    return false;
  }

  try {
    await write(entityId, { chatEnabled, rules: chatRules });
  } catch (error) {
    log('Failed to update chat settings', error);
    notify({
      kind: 'error',
      title: 'Error saving chat settings',
      description: 'There was a problem saving these settings. Please try again.',
    });
    return false;
  }

  notify({
    kind: 'success',
    title: 'Chat settings updated',
    description: `Chat ${chatEnabled ? 'enabled' : 'disabled'} for this ${entityType}`,
  });
  return true;
}
