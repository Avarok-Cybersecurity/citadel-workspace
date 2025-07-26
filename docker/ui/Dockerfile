# Base image with Node.js (choose a suitable version, e.g., LTS)
FROM rust:latest

WORKDIR /usr/src/app

# Install necessary build dependencies for crates like oqs-sys (which uses bindgen)
RUN apt-get update && \
    apt-get install -y nodejs npm vite cmake libclang-dev llvm clang && \
    rm -rf /var/lib/apt/lists/*

RUN cargo install tauri-cli

# Copy the entire workspace context
COPY . .
RUN cd citadel-workspaces
RUN npm i
RUN cd ..

EXPOSE 1420

# Run the UI via cargo tauri dev, accessible within Docker network
CMD ["cargo", "tauri", "dev"]
