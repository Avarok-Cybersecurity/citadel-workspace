#!/usr/bin/env bash
# Point apt's downloaded-package store at a directory the workflow caches, for one install.
#
# Sourced by install-chromium.sh. `playwright install --with-deps` ends in `apt-get install`
# of about 26 MB of fonts and X libraries the runner image lacks, fetched from the Azure
# mirror every time. On 2026-10-22 that mirror ran at ~40 KB/s: "Need to get 21.1 MB of
# archives" took 5 to 11 minutes, and UI run 39843446695's typecheck job hit its 15-minute cap
# inside it, twice (the index refresh before it fetched 7 MB in 6 s and was not the problem).
#
# With Dir::Cache::Archives on the restored directory, apt checks each cached .deb against the
# index it has just refreshed and downloads only what is missing or has changed, so a warm
# cache turns that fetch into "Need to get 0 B". apt still verifies every file it uses: a stale
# or corrupt cached .deb is re-fetched, never installed. Nothing here chooses packages --
# playwright's list is installed exactly as before, fonts included, which the geometry gates
# measure text with.
#
# Usage: source it, then `use_apt_archive_dir <absolute dir>` before the install and
# `release_apt_archive_dir` after it (install-chromium.sh does so from an EXIT trap).

readonly APT_ARCHIVE_CONF=/etc/apt/apt.conf.d/99citadel-chromium-archives

apt_archive_dir=
count_debs() { # <dir> -> prints how many .deb files it holds
  local debs
  shopt -s nullglob
  debs=("$1"/*.deb)
  shopt -u nullglob
  echo "${#debs[@]}"
}

use_apt_archive_dir() { # <absolute dir>
  local dir=$1
  case "$dir" in
    /*) ;;
    *) echo "::error::apt archive dir must be absolute; got '$dir'" >&2; return 2 ;;
  esac
  # It is written into an apt.conf string; a quote, brace or semicolon would end it early.
  case "$dir" in
    *[\"\;\{\}]* | *$'\n'*) echo "::error::apt archive dir has a character apt.conf cannot hold: '$dir'" >&2; return 2 ;;
  esac
  mkdir -p "$dir/partial"
  apt_archive_dir=$dir
  # Sandbox user root: the dir is in the runner's home, where apt's _apt download user may not
  # be able to write; apt then falls back to root anyway, with a warning per package.
  printf 'Dir::Cache::Archives "%s/";\nAPT::Keep-Downloaded-Packages "true";\nAPT::Sandbox::User "root";\n' \
    "$dir" | sudo tee "$APT_ARCHIVE_CONF" >/dev/null
  echo "apt archives: $(count_debs "$dir") cached package(s) restored into $dir;" \
    "apt fetches only what is missing from it or changed upstream"
}

release_apt_archive_dir() { # undoes use_apt_archive_dir; a no-op when it never ran
  [ -n "$apt_archive_dir" ] || return 0
  sudo rm -f "$APT_ARCHIVE_CONF"
  # apt leaves root-owned files and an _apt-owned partial/; the cache saves as the runner user.
  sudo rm -rf "$apt_archive_dir/partial" "$apt_archive_dir/lock"
  sudo chown -R "$(id -u):$(id -g)" "$apt_archive_dir"
  echo "apt archives: $(count_debs "$apt_archive_dir") package(s) in $apt_archive_dir for the next run"
  apt_archive_dir=
}
