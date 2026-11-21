use super::*;

#[cfg(not(feature = "self-signed-servers"))]
#[test]
fn the_shipped_build_requires_a_verified_server_certificate() {
    assert_eq!(SERVER_CERTIFICATE, CertVerification::Required);
}

#[cfg(feature = "self-signed-servers")]
#[test]
fn the_development_build_takes_a_self_signed_server() {
    assert_eq!(SERVER_CERTIFICATE, CertVerification::SelfSignedAccepted);
}

#[test]
fn dangerous_is_refused_where_certificates_are_verified() {
    assert!(skips_verification(true, CertVerification::Required).is_err());
}

#[test]
fn dangerous_skips_verification_where_self_signed_servers_are_taken() {
    assert_eq!(
        skips_verification(true, CertVerification::SelfSignedAccepted),
        Ok(true)
    );
    assert_eq!(
        skips_verification(false, CertVerification::Required),
        Ok(false)
    );
}
