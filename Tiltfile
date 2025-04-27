# Tiltfile

# Ensure any previous docker-compose services are stopped before Tilt starts
local_resource(
    name='cleanup',
    cmd='docker compose down',
    # Run this only at the start
    trigger_mode=TRIGGER_MODE_MANUAL 
)

# Load backend services defined in docker-compose.yml
docker_compose('docker-compose.yml', wait=True)

# Define a local resource to run the Tauri UI development server
local_resource(
    name='ui',
    env={'RUST_LOG': 'citadel=debug'},
    serve_cmd='cd citadel-workspaces && npm install && cd .. && cargo tauri dev',
    # Make the UI resource depend on the successful completion of the 'service-checker' resource.
    resource_deps=['internal-service', 'server', 'cleanup'],
    # Run this only at the start
    trigger_mode=TRIGGER_MODE_MANUAL 
)