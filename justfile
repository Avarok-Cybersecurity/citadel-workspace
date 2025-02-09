set dotenv-load
set shell := ["sh", "-cu"]

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

    [ ! -f "${INTERNAL_SERVICE_PATH}/.server-pid" ] || { kill $(cat "${INTERNAL_SERVICE_PATH}/.server-pid") && rm "${INTERNAL_SERVICE_PATH}/.server-pid"; } &
    [ ! -f "${INTERNAL_SERVICE_PATH}/.service-pid" ] || { kill $(cat "${INTERNAL_SERVICE_PATH}/.service-pid") && rm "${INTERNAL_SERVICE_PATH}/.service-pid"; } &

[linux]
[macos]
[unix]
start-servers:
    just stop-servers

    @echo "Starting new servers"

    # Start internal service
    cd $INTERNAL_SERVICE_PATH; nohup cargo run --bin internal-service -- --bind 127.0.0.1:12345 > internal-service.log 2>&1 & echo $! > .service-pid

    # Start citadel server
    cd $INTERNAL_SERVICE_PATH; nohup cargo run --bin citadel_server -- --bind 127.0.0.1:12349 > citadel-server.log 2>&1 & echo $! > .server-pid

[linux]
[macos]
[unix]
update-gui:
     # Update submodule
    cd citadel-workspaces && git fetch && git pull && cd ..

    # Copy all contents from submodule to current directory
    cp -R citadel-workspaces/* ./

[windows]
stop-servers:
    @echo "Killing existing servers"

    if (Test-Path "$env:INTERNAL_SERVICE_PATH/.server-pid") { $processId = Get-Content "$env:INTERNAL_SERVICE_PATH/.server-pid"; taskkill /F /PID $processId 2>$null; Remove-Item "$env:INTERNAL_SERVICE_PATH/.server-pid" -ErrorAction SilentlyContinue }
    if (Test-Path "$env:INTERNAL_SERVICE_PATH/.service-pid") { $processId = Get-Content "$env:INTERNAL_SERVICE_PATH/.service-pid"; taskkill /F /PID $processId 2>$null; Remove-Item "$env:INTERNAL_SERVICE_PATH/.service-pid" -ErrorAction SilentlyContinue }

[windows]
start-servers:
    just stop-servers

    @echo "Starting new servers"

    # Start internal service
    Push-Location $env:INTERNAL_SERVICE_PATH; $process = Start-Process cargo -ArgumentList "run","--bin","internal-service","--", "--bind","127.0.0.1:12345" -NoNewWindow -PassThru -RedirectStandardOutput "internal-service.log" -RedirectStandardError "internal-service-error.log"; $process.Id | Set-Content ".service-pid"; $process | Out-Null

    # Start citadel server
    Push-Location $env:INTERNAL_SERVICE_PATH; $process = Start-Process cargo -ArgumentList "run","--bin","citadel_server","--", "--dangerous", "true", "--bind", "127.0.0.1:12349" -NoNewWindow -PassThru -RedirectStandardOutput "citadel-server.log" -RedirectStandardError "citadel-server-error.log"; $process.Id | Set-Content ".server-pid"; $process | Out-Null; Pop-Location

[windows]
update-gui:
    Push-Location citadel-workspaces; git fetch; git pull; Pop-Location

    Get-ChildItem -Path "citadel-workspaces\*" -Recurse | Copy-Item -Destination "." -Force -Recurse
