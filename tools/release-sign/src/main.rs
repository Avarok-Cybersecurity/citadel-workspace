//! The file I/O around lib.rs. Exits non-zero, saying why, on the first failure.

use citadel_release_signature::{parse_public_key, ReleaseSigningKey, SEED_LEN};
use release_sign::{asset_name, parse, sign, signature_path, verify, Command, USAGE};
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use zeroize::{Zeroize, Zeroizing};

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
    let mut seed = [0u8; SEED_LEN];
    getrandom::fill(&mut seed).map_err(|e| format!("no OS randomness: {e}"))?;
    let key = ReleaseSigningKey::from_seed(&seed);
    let mut encoded = Zeroizing::new(String::with_capacity(SEED_LEN * 2 + 1));
    for byte in seed {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded.push('\n');
    seed.zeroize();
    let mut file = create_private(private_key)?;
    file.write_all(encoded.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("{}: {e}", private_key.display()))?;
    let public = format!("{}\n", key.public_key_hex());
    if let Some(path) = public_key {
        std::fs::write(path, &public).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    print!("{public}");
    Ok(())
}

fn create_private(path: &Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("{} (keygen never overwrites a key): {e}", path.display()))
}

fn read_private_key(path: &Path) -> Result<ReleaseSigningKey, String> {
    let text = Zeroizing::new(read_text(path)?);
    ReleaseSigningKey::from_seed_hex(&text).map_err(|e| e.to_string())
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}
