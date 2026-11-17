import { useState , type Dispatch , type SetStateAction } from 'react';
import type { JoinFormData } from '@/components/useJoinRegistration';
import { BLANK_JOIN_FORM as BLANK } from '@/components/join-form-blank';

/**
 * What the user has typed on the wizard's profile step.
 *
 * Held above the step because that step unmounts whenever they go Back to
 * security, and its own state went with it: one step back to check a setting
 * cleared the name, the username and both passwords. The server address and the
 * security settings already live at this level for the same reason.
 *
 * `clear` exists because half of this is passwords: the draft should not outlive
 * the registration it belonged to, nor greet the next one.
 */
export function useProfileDraft(): { draft: JoinFormData; setDraft: Dispatch<SetStateAction<JoinFormData>>; clear: () => void; } {
  const [draft, setDraft] = useState<JoinFormData>(BLANK);
  return {
    draft,
    setDraft,
    clear: (): void => setDraft(BLANK),
  };
}
