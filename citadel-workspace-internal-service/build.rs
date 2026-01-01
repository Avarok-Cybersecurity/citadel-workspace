use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../citadel-internal-service/citadel-internal-service-wasm-client/src/lib.rs");
    println!("cargo:rerun-if-changed=../citadel-internal-service/citadel-internal-service-types/src/lib.rs");

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

    // Only write package.json to wasm-client-ts, not to public/wasm
    if dst.ends_with("wasm-client-ts") || dst.ends_with("typescript-client") {
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
