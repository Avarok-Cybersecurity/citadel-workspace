set dotenv-load

set windows-shell := ["powershell.exe", "-c"]
set shell := ["sh", "-cu"]

[linux]
[macos]
[unix]
[windows]
ui:
    RUST_LOG=citadel=info cargo tauri dev

[linux]
[macos]
[unix]
dev:
    just start-servers
    cargo tauri dev

[windows]
dev:
    just start-servers
    cargo tauri dev

dev-browser:
    just start-servers
    bun run dev

[linux]
[macos]
[unix]
stop-servers:
    @echo "Killing existing servers"

    [ ! -f "./.server-pid" ] || { kill $(cat "./.server-pid") && rm "./.server-pid"; } &
    [ ! -f "./.service-pid" ] || { kill $(cat "./.service-pid") && rm "./.service-pid"; } &

[linux]
[macos]
[unix]
start-servers:
    just stop-servers

    @echo "Starting new servers"

    # Start internal service
    nohup cargo run --bin citadel-workspace-internal-service -- --bind 127.0.0.1:12345 > internal-service.log 2>&1 & echo $! > .service-pid

    # Start citadel server
    nohup cargo run --bin citadel-workspace-server-kernel -- --bind 127.0.0.1:12349 > citadel-server.log 2>&1 & echo $! > .server-pid

[windows]
stop-servers:
    @echo "Killing existing servers"

    if (Test-Path "./.server-pid") { $processId = Get-Content "./.server-pid"; taskkill /F /PID $processId 2>$null; Remove-Item "./.server-pid" -ErrorAction SilentlyContinue }
    if (Test-Path "./.service-pid") { $processId = Get-Content "./.service-pid"; taskkill /F /PID $processId 2>$null; Remove-Item "./.service-pid" -ErrorAction SilentlyContinue }

[windows]
start-servers:
    just stop-servers

    @echo "Starting new servers"

    # Start internal service
    $process = Start-Process cargo -ArgumentList "run","--bin","citadel-workspace-internal-service","--", "--bind","127.0.0.1:12345" -NoNewWindow -PassThru -RedirectStandardOutput "internal-service.log" -RedirectStandardError "internal-service-error.log"; $process.Id | Set-Content ".service-pid"; $process | Out-Null

    # Start citadel server
    $process = Start-Process cargo -ArgumentList "run","--bin","citadel-workspace-server-kernel","--", "--dangerous", "true", "--bind", "127.0.0.1:12349" -NoNewWindow -PassThru -RedirectStandardOutput "citadel-server.log" -RedirectStandardError "citadel-server-error.log"; $process.Id | Set-Content ".server-pid"; $process | Out-Null

[linux]
[macos]
[unix]
[windows]
is:
    RUST_LOG=citadel=info cargo run --bin citadel-workspace-internal-service -- --bind 127.0.0.1:12345

[linux]
[macos]
[unix]
[windows]
server:
    RUST_LOG=citadel=info cargo run --bin citadel-workspace-server-kernel -- --bind 127.0.0.1:12349

submodules:
    # Initialize and update all submodules recursively
    git submodule update --init --recursive

[linux]
[macos]
[unix]
gui-update:
    just submodules
    # Update submodule
    cd citadel-workspaces && git fetch && git pull && cd ..

[windows]
gui-update:
    just submodules
    # Update submodule
    Push-Location citadel-workspaces; git fetch; git pull; Pop-Location

icon-updates:
    cargo tauri icon


[linux]
[macos]
[unix]
gui-push commit-message:
    cd citadel-workspaces && git commit -am "{{commit-message}}" && git push

[windows]
gui-push commit-message:
    Push-Location citadel-workspaces; git commit -am "{{commit-message}}" && git push; Pop-Location