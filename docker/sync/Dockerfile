# Multi-tool image for WASM client synchronization
# Includes Rust toolchain, wasm-pack, Node.js, and build tools
FROM rust:latest

# Install Node.js 20.x
RUN apt-get update && \
    apt-get install -y curl git && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install wasm-pack
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

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

# Run sync script with no-restart flag (Tilt handles service restarts)
CMD ["./sync-wasm-clients.sh", "--no-restart"]
