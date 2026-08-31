# Multi-tool image for WASM client synchronization
# Includes Rust toolchain, wasm-pack, Node.js, and build tools
FROM rust:1.92.0

# Install Node.js 20.x
RUN apt-get update && \
    apt-get install -y curl git && \
    for attempt in 1 2 3 4 5; do \
      curl -fsSL --connect-timeout 30 --max-time 300 -o /tmp/nodesource_setup.sh https://deb.nodesource.com/setup_20.x \
        && bash /tmp/nodesource_setup.sh && break; \
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
#
# `--max-time` is a different question from the retry and both are needed. A
# retry answers a fetch that FAILS; a fetch that STALLS sits on attempt one
# until something outside kills it. `pull-base-images.sh` had the retries and
# not the bound, and a stalled `docker pull` took `test:settings-controls` down
# with the job budget in run 33308312708 -- see round 456. Curl waits for ever
# by default.
# Downloaded to a file, then run -- NOT `curl … | sh`.
#
# A pipeline's exit status is its LAST command's. `sh` reads empty input from a
# failed curl and exits 0, so `curl … | sh && break` broke out on attempt one
# and the five attempts below were decoration. Run 33352898046 proves it: curl
# reported `(35) Recv failure: Connection reset by peer` and `wasm-pack: not
# found` followed 1ms later, with no retry message in between, taking
# `test:p2p-types` down with the whole image.
RUN for attempt in 1 2 3 4 5; do \
      curl -sSf --connect-timeout 30 --max-time 300 -o /tmp/wasm-pack-init.sh https://rustwasm.github.io/wasm-pack/installer/init.sh \
        && sh /tmp/wasm-pack-init.sh && break; \
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
