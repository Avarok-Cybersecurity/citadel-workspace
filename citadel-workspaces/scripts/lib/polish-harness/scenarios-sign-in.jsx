/** The "Sign in with Citadel" consent dialog, as the page opens it: a short name, and the widest the allowlist allows. */
import { ConsentDialog } from '@/components/sign-in-with-citadel/ConsentDialog';

const NOOP = () => {};

function Consent({ displayName, clientId, error }) {
  return (
    <ConsentDialog displayName={displayName} clientId={clientId} device="Chrome on macOS" words={['argue', 'occur', 'napkin']}
      idFp="3forj6ftckvpoy2r" busy={false} error={error} onApprove={NOOP} onCancel={NOOP} />
  );
}

export const SIGN_IN_SCENARIOS = {
  'sign-in-consent': () => <Consent displayName="synchronized.work" clientId="synchronized.work" error={null} />,
  // 64 characters, the schema's display_name maximum, and a 64-character client id with no break in it.
  'sign-in-consent-widest': () => (
    <Consent displayName={'A'.repeat(20) + ' extraordinarily-long-application-name-x' + 'Z'.repeat(4)}
      clientId={'client-' + 'x'.repeat(56) + 'z'} error="wrong_password" />
  ),
};
