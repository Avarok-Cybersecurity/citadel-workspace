use std::env;
use std::path::PathBuf;

fn main() {
    // Get the output directory for TypeScript types
    let out_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .join("citadel-workspace-client-ts")
        .join("src")
        .join("types");

    // Create the directory if it doesn't exist
    std::fs::create_dir_all(&out_dir).unwrap();

    // Set the TS_RS_EXPORT_DIR environment variable
    env::set_var("TS_RS_EXPORT_DIR", out_dir.to_str().unwrap());

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/structs.rs");
}
