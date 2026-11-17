import { SignInKeysSection } from '@/components/passkey/SignInKeysSection';
import { SecureLinksSection } from '@/components/share/SecureLinksSection';
import { DocumentsOnThisDeviceSection } from './DocumentsOnThisDeviceSection';

/** Settings -> Security: how you sign in, the secure links you have handed out, and the documents this device keeps. */
export function SecuritySettingsTab(): JSX.Element {
  return (
    <div className="space-y-6">
      <SignInKeysSection />
      <SecureLinksSection />
      <DocumentsOnThisDeviceSection />
    </div>
  );
}
