#!/usr/bin/env bash
# Fails unless the .deb is a correctly renamed crustdesk package carrying the given custom.txt.
set -euo pipefail
deb=$(realpath "$1") custom=$(realpath "$2")
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
dpkg-deb -R "$deb" "$work/pkg"
cd "$work/pkg"
rc=0
fail() { echo "FAIL: $*" >&2; rc=1; }
has() { grep -qE -- "$2" "$1" 2>/dev/null || fail "$1: missing $2"; }

has DEBIAN/control '^Package: crustdesk$'
has DEBIAN/control '^Description: .*RustDesk fork'
has DEBIAN/control '^Conflicts: rustdesk, rustdesk-unattended-wayland$'
has DEBIAN/control '^Maintainer: crabamole <https://github.com/crabamole>$'
! grep -qE '^(Replaces|Provides):' DEBIAN/control || fail "DEBIAN/control: Replaces/Provides present"

[ -f usr/share/crustdesk/crustdesk ] && [ -x usr/share/crustdesk/crustdesk ] || fail "usr/share/crustdesk/crustdesk is not an executable file"
cmp -s usr/share/crustdesk/custom.txt "$custom" || fail "custom.txt differs from $custom"

svc=usr/share/crustdesk/files/systemd/crustdesk.service
has $svc '^Description=cRustDesk$'
has $svc '^ExecStart=/usr/bin/crustdesk --service$'
has $svc 'pkill -f "crustdesk --"'

has usr/share/applications/crustdesk.desktop '^Name=cRustDesk$'
has usr/share/applications/crustdesk-link.desktop '^Name=cRustDesk$'
has usr/share/applications/crustdesk.desktop '^Exec=crustdesk %u$'
has usr/share/applications/crustdesk-link.desktop '^Exec=crustdesk %u$'
has usr/share/applications/crustdesk-link.desktop '^MimeType=x-scheme-handler/rustdesk;$'

for s in postinst prerm preinst postrm; do
  has DEBIAN/$s crustdesk
  # The link scheme is the only legitimate bare rustdesk.
  ! grep -P '\brustdesk\b' DEBIAN/$s | grep -vq 'x-scheme-handler/rustdesk' || fail "DEBIAN/$s: bare rustdesk"
done

[ -z "$(find . -name '*rustdesk*' ! -name '*crustdesk*' ! -name librustdesk.so)" ] || fail "unrenamed paths: $(find . -name '*rustdesk*' ! -name '*crustdesk*' ! -name librustdesk.so | tr '\n' ' ')"

[ "$(find . -type f ! -path './DEBIAN/*' -printf '/%P\n' | sort)" = "$(awk '{print substr($0, 35)}' DEBIAN/md5sums | sort)" ] || fail "DEBIAN/md5sums does not list exactly the payload files"
sed 's|  /|  |' DEBIAN/md5sums | md5sum --quiet -c - >&2 || fail "DEBIAN/md5sums does not match the files"

[ $rc -eq 0 ] && echo "PASS: $deb"
exit $rc
