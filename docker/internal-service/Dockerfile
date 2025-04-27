# Base image with Rust
FROM rust:latest

WORKDIR /usr/src/app

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y cmake libclang-dev llvm clang netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy the entire workspace context to ensure all dependencies are available
COPY . .

# Expose port if internal-service listens on one (replace 12345 with actual port if needed)
EXPOSE 12345

# Run the internal service via cargo run
CMD ["cargo", "run", "--bin", "citadel-workspace-internal-service", "--", "--bind", "0.0.0.0:12345"]
