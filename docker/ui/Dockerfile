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

# Expose Vite dev server port
EXPOSE 5173

# Start Vite dev server with Docker-specific configuration
CMD ["npm", "run", "dev:docker"]
