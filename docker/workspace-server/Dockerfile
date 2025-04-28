# Base image with Rust
FROM rust:latest

WORKDIR /usr/src/app

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y cmake libclang-dev llvm clang netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy the entire workspace context
COPY . .

# Copy the server-kernel.toml file
COPY ./docker/workspace-server/kernel.toml .

# Expose port if server listens on one (replace 12349 with actual port if needed)
EXPOSE 12349

# Run the workspace server via cargo run
CMD ["cargo", "run", "--bin", "citadel-workspace-server-kernel", "--", "--config", "kernel.toml"]
