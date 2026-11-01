#!/usr/bin/env bash
# Removes the vcpkg binary cache packages that this build did not use, then prints a cache key
# for what is left. The files provider stores a package as <abi[0:2]>/<abi>.zip, and the ABI is
# the SHA-256 of the vcpkg_abi_info.txt that the package installs.

set -euo pipefail

cache_dir=$1
installed_dir=$2

cd "$cache_dir"
# Hash from stdin: sha256sum escapes a file name holding a backslash, as Windows paths do.
for f in "$installed_dir"/*/share/*/vcpkg_abi_info.txt; do
  echo "$(sha256sum < "$f" | cut -c1-64).zip"
done | sort -u > "$RUNNER_TEMP/vcpkg-keep.txt"
find . -name '*.zip' | sed 's|.*/||' | sort > "$RUNNER_TEMP/vcpkg-all.txt"
used=$(comm -12 "$RUNNER_TEMP/vcpkg-all.txt" "$RUNNER_TEMP/vcpkg-keep.txt" | wc -l)
echo "vcpkg binary cache: $used of $(wc -l < "$RUNNER_TEMP/vcpkg-all.txt") packages used"
if [[ $used == 0 ]]; then
  # A layout change in vcpkg would otherwise empty the cache.
  echo "::warning::No cached vcpkg package matches an installed ABI; not pruning"
else
  comm -23 "$RUNNER_TEMP/vcpkg-all.txt" "$RUNNER_TEMP/vcpkg-keep.txt" | while read -r f; do rm "${f:0:2}/$f"; done
fi
echo "key=vcpkg-$RUNNER_OS-$(sha256sum < "$RUNNER_TEMP/vcpkg-keep.txt" | cut -c1-16)" >> "$GITHUB_OUTPUT"
