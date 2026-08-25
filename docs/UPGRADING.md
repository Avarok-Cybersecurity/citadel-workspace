# Upgrading and rolling back a deployment

The machinery for this already existed and was well built; what was missing was
a description of how to use it. Every claim below is taken from
`deploy.sh`, `docker-compose.production.yml`,
`.github/workflows/publish-images.yml` and `scripts/verify-image-revisions.sh`.

## What a release is

CI builds the three images — `citadel-workspace-server`,
`citadel-workspace-internal-service`, `citadel-workspace-ui` — and publishes
each with a `sha-<12-char-commit>` tag. A **separate** `promote-latest` job then
moves `latest`, and only once every image in the release has built *and* passed
its smoke test, and only on `master`.

So `latest` cannot point at a half-published release or at a manually
dispatched branch build. A `sha-` tag is immutable and is what you pin to when a
deploy has to be reproducible.

## Upgrading

```bash
./deploy.sh
```

That pulls the latest code, pulls images at `${IMAGE_TAG:-latest}`, verifies
them, and restarts the services sequentially. **Nothing is compiled on the
host** — that was removed deliberately, so the production box needs no Rust
toolchain and no working Docker build network.

Data volumes (`server_data`, `internal_service_data`) are never touched.

## Rolling back, or pinning an exact build

```bash
IMAGE_TAG=sha-abc123456789 ./deploy.sh --no-pull
```

`--no-pull` skips the `git pull`, so the compose file stays as checked out while
the images come from the tag you named. To find a tag, list the published
versions of any of the three packages under the org's GHCR packages.

Rolling back is exactly the same operation as upgrading, pointed at an older
tag. There is no separate rollback path to get wrong.

## The guard you should not remove

`deploy.sh` runs `scripts/verify-image-revisions.sh` and **refuses the deploy**
if the three images were not built from the same commit.

This is not paranoia. `latest` is a mutable tag on three *independent* registry
repositories, and no registry offers an atomic multi-repository tag update. A
promotion that succeeds for one image and then fails partway — a transient auth
or registry error — leaves `latest` pointing at a mismatched set. Restarting
production on two backend versions that never shipped together is the failure
this prevents, and the tag alone cannot tell you it happened. CI stamps each
image with `org.opencontainers.image.revision`; the script compares the
artifacts rather than trusting the label.

## What the browser does on upgrade

Server-side upgrade is only half of it — clients are installed PWAs and cache
themselves deliberately.

* **Installed clients** (a service worker is in control) do not reload on their
  own, by design: the app holds live P2P sessions and yanking the page from
  under one would drop them. The new worker installs and waits, the app raises
  an **"Update available"** prompt with a Reload action, and the user takes it
  when convenient. `check:pwa-update` covers install → deploy → prompt →
  activate.
* **Everyone else** — first visit, service workers unavailable, or a
  registration evicted (Safari discards them after ~7 days unused) — is served
  by nginx, where `index.html` carries `Cache-Control: public, no-cache`. It
  revalidates, so a deploy reaches them on the next load. It must not be
  `immutable`: the shell names the content-hashed `/assets/` bundles, which
  *are* immutable, so a stale shell keeps requesting the old bundles — and they
  still exist and still load, leaving the user silently on an older build with
  nothing in the console to show for it.

`scripts/smoke-ui-ws.sh` asserts both of those cache headers against a built
image, so this cannot regress unnoticed.

## Verifying a deploy

```bash
docker compose -f docker-compose.production.yml ps
./scripts/smoke-ui-ws.sh <image-ref> 18080
```

`scripts/check-doc-env-vars.sh` fails CI if a deployment doc names an
environment variable nothing reads — a doc describing a security control that
does not exist is worse than no doc, since setting the variable changes nothing
while the runbook says it is locked down.
