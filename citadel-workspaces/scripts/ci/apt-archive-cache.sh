#!/usr/bin/env bash
# Point apt's downloaded-package store at a directory the workflow caches, for one install.
#
# Sourced by install-chromium.sh. Playwright's Chromium needs about 26 MB of fonts and X
# libraries the runner image lacks, which used to be fetched from the Azure mirror every
# time. On 2026-10-22 that mirror ran at ~40 KB/s: "Need to get 21.1 MB of archives" took 5
# to 11 minutes, and UI run 39843446695's typecheck job hit its 15-minute cap inside it, twice.
#
# With Dir::Cache::Archives on the restored directory, a mirror fetch downloads only what is
# missing from it or has changed. A warm cache is installed with no fetch at all
# (chromium-system-packages.sh), which is why the directory is pruned before it is saved: it
# keeps exactly the archives whose version is the one now installed, one per package, so the
# next run on the image installs the same set. Nothing here chooses packages -- playwright's list
# is installed exactly as before, fonts included, which the geometry gates measure text with.
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

# apt names an archive <package>_<version, ':' as %3a>_<arch>.deb.
prune_to_installed() { # <dir> : removes each .deb whose version is not the installed one
  local deb base name version installed
  shopt -s nullglob
  for deb in "$1"/*.deb; do
    base=${deb##*/}
    name=${base%%_*}
    version=${base#*_}
    version=${version%_*}
    version=${version//'%3a'/:}
    installed=$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null) || installed=
    if [ "$installed" != "$version" ]; then
      rm -f "$deb"
      echo "apt archives: dropped $base (installed: ${installed:-none})"
    fi
  done
  shopt -u nullglob
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
  echo "apt archives: $(count_debs "$dir") cached package(s) restored into $dir"
}

release_apt_archive_dir() { # undoes use_apt_archive_dir; a no-op when it never ran
  [ -n "$apt_archive_dir" ] || return 0
  sudo rm -f "$APT_ARCHIVE_CONF"
  # apt leaves root-owned files and an _apt-owned partial/; the cache saves as the runner user.
  sudo rm -rf "$apt_archive_dir/partial" "$apt_archive_dir/lock"
  sudo chown -R "$(id -u):$(id -g)" "$apt_archive_dir"
  prune_to_installed "$apt_archive_dir"
  echo "apt archives: $(count_debs "$apt_archive_dir") package(s) in $apt_archive_dir for the next run"
  apt_archive_dir=
}
