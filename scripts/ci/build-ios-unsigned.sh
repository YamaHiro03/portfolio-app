#!/usr/bin/env bash
# Run after npm ci, npm run build and npx cap sync ios on a macOS runner.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Unsigned iOS builds require macOS and Xcode.' >&2
  exit 1
fi
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/folio-unsigned.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT

xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath "$build_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build

app="$build_dir/DerivedData/Build/Products/Release-iphoneos/App.app"
# Reject simulator products and missing executables before creating the IPA.
python3 - "$app" <<'PY'
import pathlib, plistlib, subprocess, sys
app = pathlib.Path(sys.argv[1])
with (app / 'Info.plist').open('rb') as file:
    info = plistlib.load(file)
if info.get('CFBundleSupportedPlatforms') != ['iPhoneOS']:
    raise SystemExit('Expected an iPhoneOS app, not a simulator app')
executable = app / info['CFBundleExecutable']
subprocess.run(['lipo', '-verify_arch', 'arm64', str(executable)], check=True)
if not (app / 'public' / 'index.html').is_file():
    raise SystemExit('Missing bundled web app; run npm run build and npx cap sync ios first')
PY
mkdir -p "$build_dir/package/Payload" artifacts
# Preserve frameworks, resources, symlinks and executable permissions.
ditto "$app" "$build_dir/package/Payload/App.app"
(cd "$build_dir/package" && /usr/bin/zip -q -r -y "$build_dir/folio-ios-unsigned.ipa" Payload)
python3 - "$build_dir/folio-ios-unsigned.ipa" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    if archive.testzip() is not None:
        raise SystemExit('Corrupt IPA archive')
    if 'Payload/App.app/Info.plist' not in archive.namelist():
        raise SystemExit('Missing Payload/App.app/Info.plist')
PY
mv "$build_dir/folio-ios-unsigned.ipa" artifacts/folio-ios-unsigned.ipa
echo 'Created artifacts/folio-ios-unsigned.ipa (requires re-signing with AltStore Classic)'
