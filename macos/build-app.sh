#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS App must be built on macOS." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_binary="${1:-$(command -v node)}"
app_bundle="${2:-$repo_root/release/UBC作业管理工具.app}"

if [[ ! -x "$node_binary" || -e "$app_bundle" ]]; then
  echo "Provide an executable Node.js binary and an unused output path." >&2
  exit 1
fi

node_major="$("$node_binary" -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

version="$("$node_binary" -p 'require(process.argv[1]).version' "$repo_root/package.json")"
deployment_target="12.0"
case "$(uname -m)" in
  arm64|x86_64) swift_target="$(uname -m)-apple-macosx${deployment_target}" ;;
  *) echo "Unsupported macOS CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac
macos_dir="$app_bundle/Contents/MacOS"
resources_dir="$app_bundle/Contents/Resources"
mkdir -p "$macos_dir" "$resources_dir/runtime"

swiftc -O -target "$swift_target" -parse-as-library -framework AppKit -framework WebKit -framework UserNotifications "$repo_root/macos/App.swift" \
  -o "$macos_dir/UBC作业管理工具"
swiftc -O -target "$swift_target" -framework Security "$repo_root/macos/EmailKeychain.swift" -o "$resources_dir/runtime/email-keychain"
for binary in "$macos_dir/UBC作业管理工具" "$resources_dir/runtime/email-keychain"; do
  minos="$(xcrun vtool -show-build "$binary" | awk '$1 == "minos" { print $2; exit }')"
  if [[ "$minos" != "$deployment_target" ]]; then
    echo "Wrong minimum macOS version in $binary: expected $deployment_target, got ${minos:-unknown}." >&2
    exit 1
  fi
done
cp "$node_binary" "$resources_dir/runtime/node"
chmod 755 "$resources_dir/runtime/node" "$resources_dir/runtime/email-keychain" "$macos_dir/UBC作业管理工具"
cp "$repo_root/app.js" "$repo_root/package.json" "$resources_dir/"
cp -R "$repo_root/lib" "$repo_root/public" "$resources_dir/"

cat > "$app_bundle/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>UBC作业管理工具</string>
  <key>CFBundleIdentifier</key><string>com.anonchihaya.ubc-assignment-manager</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>UBC作业管理工具</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>$deployment_target</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF

plutil -lint "$app_bundle/Contents/Info.plist"
codesign --force --sign - "$app_bundle"
codesign --verify --deep --strict --verbose=2 "$app_bundle"
echo "Created $app_bundle"
