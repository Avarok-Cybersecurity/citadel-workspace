set dotenv-load
set shell := ["zsh", "-cu"]

dev:
    just start-servers
    cargo tauri dev

dev-browser:
    just start-servers
    bun run dev


stop-servers:
    @echo "Killing existing servers"

    [ ! -f "${INTERNAL_SERVICE_PATH}/.server-pid" ] || { kill $(cat "${INTERNAL_SERVICE_PATH}/.server-pid") && rm "${INTERNAL_SERVICE_PATH}/.server-pid"; } &
    [ ! -f "${INTERNAL_SERVICE_PATH}/.service-pid" ] || { kill $(cat "${INTERNAL_SERVICE_PATH}/.service-pid") && rm "${INTERNAL_SERVICE_PATH}/.service-pid"; } &


start-servers:
    just stop-servers

    @echo "Starting new servers"

    # Start internal service
    cd $INTERNAL_SERVICE_PATH; nohup cargo run --bin internal-service -- --bind 127.0.0.1:12345 > internal-service.log 2>&1 &; echo $! > .service-pid

    # Start citadel server
    cd $INTERNAL_SERVICE_PATH; nohup cargo run --bin citadel_server -- --bind 127.0.0.1:12349 > citadel-server.log 2>&1 &; echo $! > .server-pid