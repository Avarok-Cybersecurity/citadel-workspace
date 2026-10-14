//! The I/O around lib.rs: the key file, the clock, randomness and HTTPS. Exits non-zero, saying
//! why, on the first failure; a refusal from the control plane is printed as it was answered.

use citadel_support_signature::{SupportSigningKey, NONCE_LEN};
use release_sign::keyfile::{create_seed_file, read_seed_file};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use telemetry_read::{parse, request, Command, USAGE};

/// How long one request may take, connect to last byte.
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = parse(&args)
        .map_err(|e| format!("{e}\n{USAGE}"))
        .and_then(run);
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("telemetry-read: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Keygen { private_key } => {
            let key = SupportSigningKey::from_seed(&*create_seed_file(&private_key)?);
            println!("{}", key.public_key_hex());
            Ok(())
        }
        Command::Read {
            control,
            private_key,
            action,
        } => {
            let key = SupportSigningKey::from_seed(&*read_seed_file(&private_key)?);
            let mut nonce = [0u8; NONCE_LEN];
            getrandom::fill(&mut nonce).map_err(|e| format!("no OS randomness: {e}"))?;
            let now_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| format!("the clock is before 1970: {e}"))?
                .as_millis() as u64;
            let url = format!("{}{}", control.origin, Command::path(&action));
            let signed = key.sign(&request(&control, action, &nonce, now_ms));
            drop(key);
            let body = serde_json::to_string(&signed).map_err(|e| e.to_string())?;
            let mut response = agent()
                .post(&url)
                .header("content-type", "application/json")
                .send(body)
                .map_err(|e| format!("{url}: {e}"))?;
            let status = response.status();
            let text = response
                .body_mut()
                .read_to_string()
                .map_err(|e| format!("{url}: reading the answer: {e}"))?;
            if status.is_success() {
                println!("{text}");
                Ok(())
            } else {
                Err(format!("{url} answered {status}: {text}"))
            }
        }
    }
}

/// HTTPS whose only key exchange is the hybrid post-quantum X25519MLKEM768 (TLS 1.3): a server
/// that cannot do it is refused rather than reached over a classical-only exchange.
fn agent() -> ureq::Agent {
    let base = rustls::crypto::aws_lc_rs::default_provider();
    let provider = rustls::crypto::CryptoProvider {
        kx_groups: vec![rustls::crypto::aws_lc_rs::kx_group::X25519MLKEM768],
        ..base
    };
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::Rustls)
        .unversioned_rustls_crypto_provider(Arc::new(provider))
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .https_only(true)
        .http_status_as_error(false)
        .timeout_global(Some(HTTP_TIMEOUT))
        .build()
        .into()
}
