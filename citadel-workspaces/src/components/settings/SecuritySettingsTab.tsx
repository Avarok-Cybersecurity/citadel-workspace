import { SignInKeysSection } from '@/components/passkey/SignInKeysSection';
import { SecureLinksSection } from '@/components/share/SecureLinksSection';
import { DocumentsOnThisDeviceSection } from './DocumentsOnThisDeviceSection';
import { StaySignedInSection } from './StaySignedInSection';

/** Settings -> Security: how you sign in, how long this device stays signed in, the secure links you have handed out, and the documents this device keeps. */
export function SecuritySettingsTab(): JSX.Element {
  return (
    <div className="space-y-6">
      <SignInKeysSection />
      <StaySignedInSection />
      <SecureLinksSection />
      <DocumentsOnThisDeviceSection />
    </div>
  );
}
