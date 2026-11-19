#!/usr/bin/env bash
# Playwright's system packages for Chromium: from the cached archives when they cover the list,
# from the mirror only for what they do not. Sourced by install-chromium.sh.
#
# Run 44530131940 restored an exact cache hit -- the packages an earlier run on this very image
# had installed -- and still failed, because `playwright install --with-deps` always begins with
# `apt-get update`, and the update was what hung on the dead mirror. The archives it needed were
# already on disk. So:
#   1. dpkg-query says nothing is missing  -> no apt at all;
#   2. the cached archives are installed with --no-download: local files, no lists, no mirror;
#   3. only what dpkg-query says is STILL missing goes to the mirror (apt-bounded.sh).
# The list is Playwright's own (`install-deps --dry-run`), so this installs what --with-deps did,
# and dpkg-query checks it after step 2: a stale or partial cache falls through to the mirror
# instead of passing. Step 2 cannot plan a download (--no-download), so when the cache does not
# satisfy it, apt refuses before dpkg runs and nothing has changed.
#
# The cached archives come from this repository's Actions cache, which only its own workflows
# write: installing them trusts exactly what running this script already trusts.
#
# Requires use_apt_archive_dir (apt-archive-cache.sh) to have pointed apt at <archive-dir>, so
# step 3's downloads land there and are cached for the next run.

playwright_system_packages() { # prints Playwright's apt packages for Chromium, space-separated
  local plan list
  plan=$(npx playwright install-deps --dry-run chromium) || {
    echo "::error::'npx playwright install-deps --dry-run chromium' failed" >&2
    return 2
  }
  # It prints the command it would run:
  #   sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends <packages>"
  list=$(sed -n 's/.*apt-get install -y --no-install-recommends \([^"]*\)".*/\1/p' <<<"$plan")
  if ! grep -Eq '^[a-z0-9][a-z0-9.+:-]*( [a-z0-9][a-z0-9.+:-]*)*$' <<<"$list"; then
    echo "::error::no package list in 'playwright install-deps --dry-run' output: $plan" >&2
    return 2
  fi
  echo "$list"
}

missing_packages() { # <package>... -> prints those dpkg does not report installed
  local pkg missing=()
  for pkg in "$@"; do
    if [ "$(dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null)" != installed ]; then
      missing+=("$pkg")
    fi
  done
  echo ${missing[@]+"${missing[@]}"}
}

ensure_chromium_system_packages() { # <deadline> <archive-dir> <package>...
  local deadline=$1 dir=$2 missing debs
  shift 2
  missing=$(missing_packages "$@")
  if [ -z "$missing" ]; then
    echo "system packages: all $# present; apt is not needed"
    return 0
  fi
  shopt -s nullglob
  debs=("$dir"/*.deb)
  shopt -u nullglob
  if [ "${#debs[@]}" -gt 0 ]; then
    echo "system packages: installing ${#debs[@]} cached archive(s) with --no-download (no mirror)"
    sudo apt-get install -y --no-download --no-install-recommends "${debs[@]}" ||
      echo "::warning::apt-get could not install the cached archives without a download"
    missing=$(missing_packages "$@")
    if [ -z "$missing" ]; then
      echo "system packages: all $# installed from the cache; the mirror was not contacted"
      return 0
    fi
    echo "::warning::the cached archives did not cover: $missing"
  fi
  echo "system packages: fetching from the mirror: $missing"
  # shellcheck disable=SC2086 # one word per package
  apt_fetch_and_install "$deadline" $missing
}
