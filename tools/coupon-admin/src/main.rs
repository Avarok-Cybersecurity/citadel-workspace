//! The I/O around lib.rs: the key file, then control-request's clock, randomness and HTTPS.
//! Exits non-zero, saying why, on the first failure; a refusal from the control plane is printed
//! as it was answered.

use citadel_support_signature::{AdminSigningKey, NONCE_LEN};
use control_request::io::{nonce, now_ms, post_json};
use coupon_admin::{parse, preflight, request, within_limit, Command, USAGE};
use release_sign::keyfile::{create_seed_file, read_seed_file};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = parse(&args)
        .map_err(|e| format!("{e}\n{USAGE}"))
        .and_then(run);
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("coupon-admin: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Keygen { private_key } => {
            let key = AdminSigningKey::from_seed(&*create_seed_file(&private_key)?);
            println!("{}", key.public_key_hex());
            Ok(())
        }
        Command::Send {
            control,
            private_key,
            action,
            confirmed,
        } => {
            let now = now_ms()?;
            if let Some(notice) = preflight(&action, confirmed, now)? {
                eprintln!("{notice}");
            }
            let url = format!("{}{}", control.origin, Command::path(&action));
            let key = AdminSigningKey::from_seed(&*read_seed_file(&private_key)?);
            let signed = key.sign(&request(&control, action, &nonce::<NONCE_LEN>()?, now));
            drop(key);
            within_limit(&signed)?;
            let body = serde_json::to_string(&signed).map_err(|e| e.to_string())?;
            println!("{}", post_json(&url, body)?);
            Ok(())
        }
    }
}
