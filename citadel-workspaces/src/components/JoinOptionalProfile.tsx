import { AvatarUpload } from './settings/AvatarUpload';
import { PROFILE_PICTURE } from '@/components/settings/image-upload-kinds';
import { ProfileDetailsFields, type ProfileDetailsValues } from './settings/ProfileDetailsFields';
import type { SignupProfileFields } from '@/lib/signup-profile';
import type { OptionalFieldChange } from './join-registration-shape';

interface JoinOptionalProfileProps {
  values: SignupProfileFields;
  onChange: OptionalFieldChange;
  disabled: boolean;
}

/**
 * The Profile step's optional half. Nothing here is required to Join, and none
 * of it is checked before Join: it is sent once the account exists
 * (`signup-profile.ts`), and anything that fails is reported then.
 */
export function JoinOptionalProfile({ values, onChange, disabled }: JoinOptionalProfileProps): JSX.Element {
  return (
    <section aria-labelledby="join-optional-heading" className="space-y-4 pt-4 mt-4 border-t border-border">
      <div>
        <h3 id="join-optional-heading" className="text-sm font-semibold text-foreground">Optional details</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Your picture, email and job title are visible to members of this workspace. You can change them later in Settings.
        </p>
      </div>
      <AvatarUpload
        kind={PROFILE_PICTURE}
        currentAvatar={values.avatarData ?? undefined}
        onAvatarChange={(avatarData) => onChange('avatarData', avatarData)}
        disabled={disabled}
      />
      <ProfileDetailsFields
        idPrefix="join"
        values={{ email: values.email, title: values.title }}
        onChange={(field: keyof ProfileDetailsValues, value: string) => onChange(field, value)}
        disabled={disabled}
      />
    </section>
  );
}
