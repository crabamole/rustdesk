#!/usr/bin/env bash
# Renames a stock-layout RustDesk .deb to crustdesk and adds the signed custom.txt; upstream's packaging stays untouched.
set -euo pipefail
src=$1 custom=$2 out=$3
[ -e "$out" ] && { echo "refusing to overwrite $out" >&2; exit 1; }
src=$(realpath "$src") custom=$(realpath "$custom") out=$(realpath -m "$out")
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
dpkg-deb -R "$src" "$work/pkg"
cd "$work/pkg"
mv usr/share/rustdesk usr/share/crustdesk
mv usr/share/crustdesk/rustdesk usr/share/crustdesk/crustdesk
mv usr/share/crustdesk/files/systemd/rustdesk.service usr/share/crustdesk/files/systemd/crustdesk.service
# The binary looks for these under its lowercased app name.
mv etc/rustdesk etc/crustdesk
mv etc/pam.d/rustdesk etc/pam.d/crustdesk
for f in usr/share/applications/rustdesk*.desktop; do mv "$f" "${f/rustdesk/crustdesk}"; done
find usr/share/icons -name 'rustdesk*' -exec sh -c 'mv "$1" "$(dirname "$1")/c$(basename "$1")"' _ {} \;
install -m 644 "$custom" usr/share/crustdesk/custom.txt
# Every reference becomes crustdesk, except the link scheme, which stays rustdesk://.
grep -rlI 'rustdesk' DEBIAN usr/share/crustdesk/files usr/share/applications \
  | xargs sed -i -e 's/x-scheme-handler\/rustdesk/x-scheme-handler\/@@SCHEME@@/' -e 's/\brustdesk\b/crustdesk/g' -e 's/@@SCHEME@@/rustdesk/'
sed -i -e 's/^Package: .*/Package: crustdesk/' -e 's/^Maintainer: .*/Maintainer: crabamole <https:\/\/github.com\/crabamole>/' \
  -e 's/^Homepage: .*/Homepage: https:\/\/github.com\/crabamole\/rustdesk/' -e '/^Replaces:/d' -e '/^Provides:/d' -e '/^Conflicts:/d' DEBIAN/control
sed -i '/^Package:/a Conflicts: rustdesk, rustdesk-unattended-wayland' DEBIAN/control
cd - >/dev/null
dpkg-deb --root-owner-group -b "$work/pkg" "$out"
