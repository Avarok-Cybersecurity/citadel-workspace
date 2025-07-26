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
dc_resource('server',labels=['backend'])
dc_resource('internal-service',labels=['backend'])

# Define a local resource to run the React development server
local_resource(
    name='ui',
    serve_cmd='npm install && npm run dev',
    serve_dir='citadel-workspaces',
    deps=["citadel-workspaces/src", "citadel-workspace-client-ts/src", "../citadel-internal-service/typescript-client/src"],
    # Make the UI resource depend on the successful completion of the backend services
    resource_deps=['internal-service', 'server'],
    labels=['frontend']
)