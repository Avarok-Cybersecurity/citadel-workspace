# Multi-tool image for WASM client synchronization
# Includes Rust toolchain, wasm-pack, Node.js, and build tools
FROM rust:1.92.0

# Install Node.js 20.x
RUN apt-get update && \
    apt-get install -y curl git && \
    for attempt in 1 2 3 4 5; do \
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && break; \
      echo "nodesource setup failed (attempt $attempt/5); retrying in $((attempt * 10))s"; \
      sleep $((attempt * 10)); \
    done && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install wasm-pack
#
# Retried, because this is a single-shot download of one artifact from GitHub
# releases and EVERY integration job depends on this image building. A CI run
# died here on `curl: (35) Recv failure: Connection reset by peer` and took
# test:tree-move down with it -- a red job carrying no test signal at all.
#
# The retry has to wrap the whole pipeline, not go inside curl: the failure was
# in the downloader that init.sh itself runs, so `curl --retry` on the
# installer would have retried the wrong request.
RUN for attempt in 1 2 3 4 5; do \
      curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh && break; \
      echo "wasm-pack install failed (attempt $attempt/5); retrying in $((attempt * 10))s"; \
      sleep $((attempt * 10)); \
    done; \
    wasm-pack --version

# Verify installations
RUN rustc --version && \
    cargo --version && \
    wasm-pack --version && \
    node --version && \
    npm --version

# Set working directory
WORKDIR /workspace

# Copy sync script
COPY ./sync-wasm-clients.sh /workspace/

# Make script executable
RUN chmod +x /workspace/sync-wasm-clients.sh

# Set environment variable to indicate container mode
ENV CONTAINER_MODE=1

# Note: runs as root because it needs write access to mounted workspace volumes
# (creates dirs like citadel-workspaces/public/wasm during WASM sync)

# Run sync script with no-restart flag (Tilt handles service restarts)
CMD ["./sync-wasm-clients.sh", "--no-restart"]
