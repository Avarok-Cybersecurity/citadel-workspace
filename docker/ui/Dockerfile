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

# Install UI dependencies (assuming package.json is in the root or a subdir)
# Adjust path to package.json if necessary
# RUN npm install --prefix ./citadel-workspace-ui # Example if UI has its own package.json

# Expose the UI port (default Tauri dev port is 1420)
EXPOSE 1420

# Run the UI via cargo tauri dev, accessible within Docker network
CMD ["cargo", "tauri", "dev"]
