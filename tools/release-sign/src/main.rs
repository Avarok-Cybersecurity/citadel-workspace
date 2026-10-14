//! The file I/O around lib.rs. Exits non-zero, saying why, on the first failure.

use citadel_release_signature::{parse_public_key, ReleaseSigningKey};
use release_sign::keyfile::{create_seed_file, read_seed_file};
use release_sign::{asset_name, parse, sign, signature_path, verify, Command, USAGE};
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = parse(&args)
        .map_err(|e| format!("{e}\n{USAGE}"))
        .and_then(run);
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("release-sign: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command) -> Result<(), String> {
    match command {
        Command::Keygen {
            private_key,
            public_key,
        } => keygen(&private_key, public_key.as_deref()),
        Command::Sign {
            private_key,
            tag,
            assets,
        } => {
            let key = read_private_key(&private_key)?;
            for asset in &assets {
                let name = asset_name(asset)?;
                let signature =
                    sign(&key, &tag, &name, &read(asset)?).map_err(|e| e.to_string())?;
                let out = signature_path(asset);
                std::fs::write(&out, signature).map_err(|e| format!("{}: {e}", out.display()))?;
                println!("signed {name} for {tag}: {}", out.display());
            }
            Ok(())
        }
        Command::Verify {
            public_key,
            tag,
            assets,
        } => {
            let public_key = read_text(&public_key)?;
            for asset in &assets {
                let name = asset_name(asset)?;
                let signature = read_text(&signature_path(asset))?;
                verify(&public_key, &tag, &name, &read(asset)?, &signature)
                    .map_err(|e| format!("{name} ({tag}): {e}"))?;
                println!("verified {name} for {tag}");
            }
            Ok(())
        }
        Command::CheckKey { public_key } => {
            parse_public_key(&read_text(&public_key)?).map_err(|e| e.to_string())?;
            println!(
                "{} is an ML-DSA-65 release public key",
                public_key.display()
            );
            Ok(())
        }
    }
}

/// Writes the seed only to `private_key` (new, mode 0600) and prints only the public key.
fn keygen(private_key: &Path, public_key: Option<&Path>) -> Result<(), String> {
    let key = ReleaseSigningKey::from_seed(&*create_seed_file(private_key)?);
    let public = format!("{}\n", key.public_key_hex());
    if let Some(path) = public_key {
        std::fs::write(path, &public).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    print!("{public}");
    Ok(())
}

fn read_private_key(path: &Path) -> Result<ReleaseSigningKey, String> {
    Ok(ReleaseSigningKey::from_seed(&*read_seed_file(path)?))
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}
