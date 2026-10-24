//! `CITADEL_APP_SIGNING_SEED_HEX=<64 hex> sign-first-party-app <app dir> <out dir>`: writes
//! `<out>/manifest.json` and `<out>/app.mldsa.sig` for the app in `<app dir>` (its manifest.json
//! and wasm/<name>.wasm). Prints the public key's fingerprint, never the key.

use citadel_app_signature::{fingerprint, AppSigningKey, SIGNATURE_FILE_NAME};
use first_party_signer::sign;
use std::path::PathBuf;
use std::process::ExitCode;

const SEED_ENV: &str = "CITADEL_APP_SIGNING_SEED_HEX";

fn run() -> Result<String, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [app, out] = &args[..] else {
        return Err("usage: sign-first-party-app <app dir> <out dir>".into());
    };
    let seed = std::env::var(SEED_ENV).map_err(|_| format!("{SEED_ENV} is not set"))?;
    let key = AppSigningKey::from_seed_hex(&seed).map_err(|e| e.to_string())?;
    let app = PathBuf::from(app);
    let name = app
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("the app dir has no name")?;
    let read = |p: PathBuf| std::fs::read(&p).map_err(|e| format!("{}: {e}", p.display()));
    let manifest =
        String::from_utf8(read(app.join("manifest.json"))?).map_err(|e| e.to_string())?;
    let wasm = read(app.join("wasm").join(format!("{name}.wasm")))?;
    let signed = sign(&manifest, &wasm, &key)?;
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let write =
        |p: PathBuf, b: &[u8]| std::fs::write(&p, b).map_err(|e| format!("{}: {e}", p.display()));
    write(out.join("manifest.json"), &signed.manifest)?;
    write(
        out.join(SIGNATURE_FILE_NAME),
        format!("{}\n", signed.signature).as_bytes(),
    )?;
    fingerprint(&key.public_key_hex()).map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    match run() {
        Ok(print) => {
            println!("signed by {print}");
            ExitCode::SUCCESS
        }
        Err(why) => {
            eprintln!("sign-first-party-app: {why}");
            ExitCode::FAILURE
        }
    }
}
