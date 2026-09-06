use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    // DIRECTORIES, not two files. Cargo scans a directory recursively, and the
    // rule is that once any `rerun-if-changed` is emitted, ONLY those paths
    // re-trigger the script.
    //
    // This named `wasm-client/src/lib.rs` and `types/src/lib.rs`. The WASM
    // client is mostly neither: its lib.rs imports the connector's `connector`,
    // `io_interface` and `messenger` modules, and CLAUDE.md names
    // `connector/src/messenger/mod.rs` as the P2P send path. So editing the
    // send path and running `cargo build` -- which docs/WASM_BUILD.md gives as
    // the way to rebuild -- did not re-run this script, `public/wasm` kept the
    // previous binary, and the browser behaved as though the edit had not
    // happened.
    //
    // READ from scripts/wasm-source-trees.txt rather than copied out of it.
    //
    // That file is already shared by the stamp writer (sync-wasm-clients.sh) and
    // the staleness gate. This was a fourth hand-maintained copy of the same
    // list, "kept in step" by a comment and by
    // check-wasm-rebuild-triggers-match-the-stamp.mjs -- which duly caught it the
    // first time the list grew, when intersession-layer-messaging was added.
    // Reading the file makes the gate a redundancy check instead of the only
    // thing holding three copies together.
    //
    // Read at BUILD-SCRIPT RUNTIME, not with `include_str!`.
    //
    // `include_str!` is compile-time and hard-fails when the file is absent, and
    // the file IS absent in the Docker images: they copy specific crates and never
    // `scripts/`. The agent image stopped compiling with
    // `error[E0282]: type annotations needed` -- the macro failed, so `line` had no
    // type -- and every "Start Services" job in CI went down with it. A build
    // script that requires a file outside the copied tree is a build script that
    // only works in one of the two places it runs.
    //
    // `fs::read_to_string` degrades instead. Where the list is present (a host
    // checkout, which is where incremental rebuilds matter) the triggers are
    // derived from it. Where it is not, this emits a warning rather than failing:
    // those builds are one-shot and set SKIP_WASM_BUILD anyway, so there is no
    // incremental rebuild for the triggers to serve.
    //
    // It is a warning and not silence because a MISSING list on a host checkout is
    // a real problem -- editing the P2P send path would rebuild nothing -- and the
    // difference between the two cases is not something this script can see.
    let list_path = "../scripts/wasm-source-trees.txt";
    println!("cargo:rerun-if-changed={list_path}");
    match fs::read_to_string(list_path) {
        Ok(list) => {
            for line in list.lines() {
                let dir = line.trim();
                if dir.is_empty() || dir.starts_with('#') {
                    continue;
                }
                println!("cargo:rerun-if-changed=../citadel-internal-service/{dir}");
            }
        }
        Err(err) => {
            println!(
                "cargo:warning={list_path} could not be read ({err}); no WASM source tree will \
                 trigger a rebuild. Expected inside a Docker build, which copies specific crates \
                 and not scripts/. On a host checkout it means an edit to the WASM client will \
                 not rebuild it."
            );
        }
    }

    // Check if we should skip WASM building (e.g., in CI or Docker)
    if env::var("SKIP_WASM_BUILD").is_ok() {
        println!("cargo:warning=Skipping WASM build due to SKIP_WASM_BUILD environment variable");
        return;
    }

    // Check if we're in Docker (citadel-internal-service won't be available)
    if env::var("DOCKER_CONTAINER").is_ok() || !Path::new("../citadel-internal-service").exists() {
        println!("cargo:warning=Skipping WASM build in Docker environment");
        return;
    }

    // Only build in debug mode or when explicitly requested
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    if profile == "release" && env::var("FORCE_WASM_BUILD").is_err() {
        println!("cargo:warning=Skipping WASM build in release mode. Set FORCE_WASM_BUILD=1 to force build.");
        return;
    }

    // Get the workspace root
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let workspace_root = Path::new(&manifest_dir)
        .parent()
        .expect("Failed to get workspace root");

    // Define paths - citadel-internal-service is at ../citadel-internal-service from this crate
    let citadel_internal_service_root = Path::new(&manifest_dir)
        .join("../citadel-internal-service")
        .canonicalize()
        .expect("Failed to find citadel-internal-service directory");

    let wasm_client_dir =
        citadel_internal_service_root.join("citadel-internal-service-wasm-client");
    let wasm_pkg_dir = wasm_client_dir.join("pkg");

    // Target directories in citadel-workspace
    let workspace_wasm_dir = workspace_root.join("citadel-workspaces/public/wasm");
    let client_ts_pkg_dir = workspace_root.join("citadel-workspace-client-ts/pkg");

    // Check if wasm-pack is installed
    let wasm_pack_check = Command::new("wasm-pack").arg("--version").output();

    if wasm_pack_check.is_err() || !wasm_pack_check.unwrap().status.success() {
        eprintln!("Error: wasm-pack is not installed!");
        eprintln!("Please install wasm-pack: https://rustwasm.github.io/wasm-pack/installer/");
        eprintln!("Run: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh");
        std::process::exit(1);
    }

    println!("cargo:warning=Building WASM client from citadel-internal-service...");

    // Clean previous build
    if wasm_pkg_dir.exists() {
        println!("cargo:warning=Cleaning previous WASM build...");
        if let Err(e) = fs::remove_dir_all(&wasm_pkg_dir) {
            eprintln!("Warning: Failed to clean previous build: {}", e);
        }
    }

    // Build the WASM client
    let output = Command::new("wasm-pack")
        .arg("build")
        .arg("--target")
        .arg("web")
        .arg("--out-dir")
        .arg("pkg")
        .current_dir(&wasm_client_dir)
        // wasm-pack spawns its own cargo, and a nested cargo inherits the
        // toolchain wiring of the one that spawned it. Under `cargo clippy` that
        // means RUSTC_WORKSPACE_WRAPPER points at clippy-driver, which the inner
        // build cannot use for a different target, so the whole workspace lint
        // run dies inside a build script with only "wasm-pack build failed!".
        // The same build succeeds under `cargo check`, which sets no wrapper —
        // which is exactly what makes this confusing to diagnose.
        .env_remove("RUSTC_WORKSPACE_WRAPPER")
        .env_remove("RUSTC_WRAPPER")
        .env_remove("RUSTC")
        .env_remove("CARGO")
        .env_remove("CARGO_MAKEFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .output()
        .expect("Failed to execute wasm-pack");

    if !output.status.success() {
        eprintln!("wasm-pack build failed!");
        eprintln!("stdout: {}", String::from_utf8_lossy(&output.stdout));
        eprintln!("stderr: {}", String::from_utf8_lossy(&output.stderr));
        std::process::exit(1);
    }

    println!("cargo:warning=WASM build successful!");

    // Copy files to citadel-workspaces/public/wasm
    if workspace_wasm_dir.exists() {
        println!("cargo:warning=Copying WASM files to citadel-workspaces/public/wasm...");
        copy_wasm_files(&wasm_pkg_dir, &workspace_wasm_dir)
            .expect("Failed to copy WASM files to workspace");
    }

    // Also copy to the original typescript-client location
    let typescript_client_dir = citadel_internal_service_root.join("typescript-client");
    if typescript_client_dir.exists() {
        println!(
            "cargo:warning=Copying WASM files to citadel-internal-service/typescript-client..."
        );
        copy_wasm_files(&wasm_pkg_dir, &typescript_client_dir)
            .expect("Failed to copy WASM files to typescript-client");
    }

    // Copy files to citadel-workspace-client-ts/pkg
    if client_ts_pkg_dir
        .parent()
        .map(|p| p.exists())
        .unwrap_or(false)
    {
        // Create pkg directory if it doesn't exist
        if !client_ts_pkg_dir.exists() {
            fs::create_dir_all(&client_ts_pkg_dir)
                .expect("Failed to create client-ts pkg directory");
        }

        println!("cargo:warning=Copying WASM files to citadel-workspace-client-ts/pkg...");
        copy_wasm_files(&wasm_pkg_dir, &client_ts_pkg_dir)
            .expect("Failed to copy WASM files to client-ts");
    }

    // Generate TypeScript types
    println!("cargo:warning=Generating TypeScript types...");
    generate_typescript_types(&citadel_internal_service_root, workspace_root);

    println!("cargo:warning=Build script completed successfully!");
}

fn copy_wasm_files(src: &Path, dst: &Path) -> std::io::Result<()> {
    // Ensure destination exists
    fs::create_dir_all(dst)?;

    // Files to copy
    let files = [
        "citadel_internal_service_wasm_client_bg.wasm",
        "citadel_internal_service_wasm_client_bg.wasm.d.ts",
        "citadel_internal_service_wasm_client.d.ts",
        "citadel_internal_service_wasm_client.js",
    ];

    for file in &files {
        let src_file = src.join(file);
        let dst_file = dst.join(file);

        if src_file.exists() {
            fs::copy(&src_file, &dst_file)?;
            println!("cargo:warning=Copied {} to {}", file, dst.display());
        } else {
            eprintln!("Warning: {} not found in WASM build output", file);
        }
    }

    // Create proper package.json for wasm-client-ts
    let package_json = r#"{
  "name": "citadel-internal-service-wasm-client",
  "type": "module",
  "version": "0.1.0",
  "files": [
    "citadel_internal_service_wasm_client_bg.wasm",
    "citadel_internal_service_wasm_client.js",
    "citadel_internal_service_wasm_client.d.ts",
    "src/**/*",
    "dist/**/*"
  ],
  "main": "src/index.ts",
  "types": "src/index.ts",
  "sideEffects": [
    "./snippets/*"
  ]
}"#;

    // Generated destinations only. typescript-client/package.json is TRACKED IN
    // GIT and is the source of truth for that package — it carries the build,
    // clean and test scripts, the dist entry points, the exports map and the
    // dependencies, none of which the minimal literal above has.
    //
    // Writing it here destroyed all of that on every `cargo check` of this
    // workspace. The damage was not local: sync-wasm-clients.sh refuses to run
    // against a package.json with no build script, and it deletes
    // citadel-workspaces/public/wasm first, so a sync after a plain cargo check
    // left the browser fetching a WASM binary that no longer existed and every
    // internal-service call silently doing nothing. It also got committed twice,
    // because `git add -A` cannot tell a generated file from an edited one.
    if dst.ends_with("wasm-client-ts") {
        let package_file = dst.join("package.json");
        fs::write(&package_file, package_json)?;
        println!(
            "cargo:warning=Created proper package.json in {}",
            dst.display()
        );
    }

    Ok(())
}

fn generate_typescript_types(citadel_internal_service_root: &Path, workspace_root: &Path) {
    // Check if the generate_types.sh script exists
    let generate_script = citadel_internal_service_root.join("generate_types.sh");

    if !generate_script.exists() {
        println!("cargo:warning=generate_types.sh not found, skipping TypeScript type generation");
        return;
    }

    // Make the script executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&generate_script)
            .expect("Failed to get script metadata")
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&generate_script, perms).expect("Failed to set script permissions");
    }

    // Run the generate_types.sh script
    let output = Command::new("bash")
        .arg(&generate_script)
        .current_dir(citadel_internal_service_root)
        .output()
        .expect("Failed to execute generate_types.sh");

    if !output.status.success() {
        eprintln!("generate_types.sh failed!");
        eprintln!("stdout: {}", String::from_utf8_lossy(&output.stdout));
        eprintln!("stderr: {}", String::from_utf8_lossy(&output.stderr));
        // Don't fail the build, just warn
        println!("cargo:warning=TypeScript type generation failed, continuing build...");
        return;
    }

    // Copy generated types to workspace
    let src_types_dir =
        citadel_internal_service_root.join("citadel-internal-service-types/bindings");
    let dst_types_dir = workspace_root.join("citadel-workspace-client-ts/src/types");

    if src_types_dir.exists() && dst_types_dir.exists() {
        // Copy all .ts files
        if let Ok(entries) = fs::read_dir(&src_types_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("ts") {
                    let filename = path.file_name().unwrap();
                    let dst_file = dst_types_dir.join(filename);
                    if let Err(e) = fs::copy(&path, &dst_file) {
                        eprintln!("Warning: Failed to copy {:?}: {}", filename, e);
                    } else {
                        println!("cargo:warning=Copied TypeScript type: {:?}", filename);
                    }
                }
            }
        }
    }
}
