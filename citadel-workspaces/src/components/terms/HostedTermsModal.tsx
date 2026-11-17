import type { JSX } from 'react';
import { TermsAcceptanceModal } from '@/components/terms/TermsAcceptanceModal';
import { PLATFORM_TERMS_DOCUMENT } from '@/lib/terms/legal-documents';

/** Avarok's Terms of Use as put to someone creating an account. Loaded only when it opens. */
export default function HostedTermsModal({ onAccept, onCancel }: { readonly onAccept: () => void; readonly onCancel: () => void }): JSX.Element {
  return (
    <TermsAcceptanceModal
      title="Terms of Use"
      documents={[PLATFORM_TERMS_DOCUMENT]}
      agreement="I have read and agree to the Terms of Use."
      onAccept={onAccept}
      onCancel={onCancel}
    />
  );
}
