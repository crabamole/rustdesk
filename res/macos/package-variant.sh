#!/usr/bin/env bash
# Packages one macOS build variant (app name, bundle ID, custom.txt) from a
# built RustDesk.app. Unsigned output; Task 4's workflow signs afterwards.
set -euo pipefail

if [ $# -ne 5 ]; then
  echo "usage: package-variant.sh <source RustDesk.app> <custom.txt> <app-name> <bundle-id> <output dir>" >&2
  exit 1
fi
src_app=$1 custom_txt=$2 app_name=$3 bundle_id=$4 out_dir=$5

if [ ! -d "$src_app" ]; then
  echo "source app not found: $src_app" >&2
  exit 1
fi
if [ ! -f "$custom_txt" ]; then
  echo "custom.txt not found: $custom_txt" >&2
  exit 1
fi

out_bundle="$out_dir/$app_name.app"
if [ -e "$out_bundle" ]; then
  echo "refusing to overwrite existing bundle: $out_bundle" >&2
  exit 1
fi

mkdir -p "$out_dir"
# ditto preserves symlinks inside frameworks (plain cp -R would dereference them).
ditto "$src_app" "$out_bundle"

contents="$out_bundle/Contents"
old_exe="$contents/MacOS/RustDesk"
new_exe="$contents/MacOS/$app_name"
if [ ! -f "$old_exe" ]; then
  echo "expected executable not found: $old_exe" >&2
  exit 1
fi
if [ "$old_exe" != "$new_exe" ]; then
  mv "$old_exe" "$new_exe"
fi

plist="$contents/Info.plist"
PlistBuddy=/usr/libexec/PlistBuddy
set_string() {
  local key=$1 value=$2
  if "$PlistBuddy" -c "Print :$key" "$plist" >/dev/null 2>&1; then
    "$PlistBuddy" -c "Set :$key $value" "$plist"
  else
    "$PlistBuddy" -c "Add :$key string $value" "$plist"
  fi
}
set_string CFBundleExecutable "$app_name"
set_string CFBundleName "$app_name"
set_string CFBundleDisplayName "$app_name"
set_string CFBundleIdentifier "$bundle_id"
set_string "CFBundleURLTypes:0:CFBundleURLName" "$bundle_id"

cp "$custom_txt" "$contents/Resources/custom.txt"

# Drop any inherited signature so the bundle is unambiguously unsigned before Task 4 signs it.
codesign --remove-signature "$out_bundle" 2>/dev/null || true

echo "$out_bundle"
