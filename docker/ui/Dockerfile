# UI Development Container with HMR Support
FROM node:20-alpine AS dev

WORKDIR /app

# Copy package.json only (not package-lock.json to avoid platform-specific deps)
COPY citadel-workspaces/package.json ./
RUN npm install --package-lock-only && npm install

# Note: Configuration files (vite.config.ts, tsconfig.json, etc.)
# are mounted via volumes at runtime, not copied at build time.
# This allows hot-reloading of config changes during development.

# Enable file watching for HMR
# Polling is required for Docker volume mounts to detect file changes
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=100
ENV NODE_ENV=development

# Run as non-root user for security hardening
# Use GID/UID 1001 to avoid conflicts with Alpine's default GID 1000
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app
USER appuser

# Pre-create Vite cache directory AFTER switching to non-root user
# This ensures the named volume inherits appuser ownership on first mount
RUN mkdir -p /app/node_modules/.vite/deps

# Expose Vite dev server port
EXPOSE 5291

# Start Vite dev server with Docker-specific configuration
CMD ["npm", "run", "dev:docker"]

# ==============================================================================
# Production build stage
# ==============================================================================
FROM node:20-alpine AS build

WORKDIR /app

# Copy package.json and install dependencies
COPY citadel-workspaces/package.json ./
# Copy the local file dependencies required by package.json
COPY citadel-workspace-client-ts /workspace/citadel-workspace-client-ts
COPY citadel-internal-service/typescript-client /workspace/citadel-internal-service-wasm-client

# Rewrite file: references so they resolve inside the container
RUN sed -i 's|file:../citadel-internal-service/typescript-client|file:/workspace/citadel-internal-service-wasm-client|' package.json && \
    sed -i 's|file:../citadel-workspace-client-ts|file:/workspace/citadel-workspace-client-ts|' package.json

RUN npm install --package-lock-only && npm install

# Copy the full UI source tree
COPY citadel-workspaces/ ./

# Build for production
ENV NODE_ENV=production
RUN npm run build

# ==============================================================================
# Production serve stage - static files via nginx
# ==============================================================================
FROM nginx:stable-alpine AS production

# Copy the built static assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Custom nginx config for SPA routing (all routes -> index.html)
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # Gzip compression\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm;\n\
    gzip_vary on;\n\
    gzip_min_length 256;\n\
\n\
    # Cache static assets aggressively (hashed filenames from Vite)\n\
    location /assets/ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    # WASM files\n\
    location ~* \\.wasm$ {\n\
        types { application/wasm wasm; }\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    # SPA fallback - serve index.html for all non-file routes\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
