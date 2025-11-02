# Tiltfile

# Run server locally
#local_resource(
#    name='server',
#    env={"RUST_LOG": "citadel=trace"},
#    serve_cmd='cargo run --bin citadel-workspace-server-kernel -- --config docker/workspace-server/kernel.toml',
#    deps=["citadel-workspace-server-kernel", "citadel-workspace-types"],
#    serve_dir='.',
#)

# Run internal service locally
#local_resource(
#    name='internal-service',
#    env={"RUST_LOG": "citadel=trace"},
#    serve_cmd='cargo run --bin citadel-workspace-internal-service -- --bind 127.0.0.1:12345',
#    serve_dir='.',
#    deps=["citadel-workspace-internal-service", "citadel-workspace-types"],
#    resource_deps=['server'],
#)

docker_compose('./docker-compose.yml')

# Configure Docker Compose resources to only rebuild manually
# This prevents losing in-memory state during development
dc_resource(
    'sync-wasm-client',
    labels=['init'],
    trigger_mode=TRIGGER_MODE_MANUAL  # Only rebuild when explicitly triggered
)

dc_resource(
    'server',
    labels=['backend'],
    resource_deps=['sync-wasm-client'],
    trigger_mode=TRIGGER_MODE_MANUAL  # Only rebuild when explicitly triggered
)

dc_resource(
    'internal-service',
    labels=['backend'],
    resource_deps=['sync-wasm-client'],
    trigger_mode=TRIGGER_MODE_MANUAL  # Only rebuild when explicitly triggered
)

# "dev": "vite build --mode development && vite --force",
# Define a local resource to run the React development server
local_resource(
    name='ui',
    serve_cmd='npm install && vite build --mode development && vite --force',
    serve_dir='citadel-workspaces',
    # Make the UI resource depend on the successful completion of the backend services
    resource_deps=['internal-service', 'server', 'sync-wasm-client'],
    labels=['frontend']
)