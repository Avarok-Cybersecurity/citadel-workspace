# Base image with Rust
FROM rust:latest

WORKDIR /usr/src/app
ARG INTERNAL_SERVICE_PORT
ENV INTERNAL_SERVICE_PORT=${INTERNAL_SERVICE_PORT}

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y cmake libclang-dev llvm clang netcat-openbsd curl && \
    rm -rf /var/lib/apt/lists/*

# Dynamically expose the port from the build argument
EXPOSE ${INTERNAL_SERVICE_PORT}

# Run the internal service via cargo run, using sh -c for variable expansion
CMD ["sh", "-c", "cargo run --bin citadel-workspace-internal-service -- --bind 0.0.0.0:${INTERNAL_SERVICE_PORT}"]
