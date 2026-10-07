#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS release archives must be built on macOS." >&2
  exit 1
fi

arch="${1:?Pass arm64 or x64 as the first argument}"
output_dir="${2:?Pass an output directory as the second argument}"
case "$arch" in
  arm64)
    expected_cpu="arm64"
    expected_sha="23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53"
    ;;
  x64)
    expected_cpu="x86_64"
    expected_sha="8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8"
    ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_version="v22.23.3"
archive="node-${node_version}-darwin-${arch}.tar.gz"
temp_dir="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then hdiutil detach "$temp_dir/mounted" -quiet || true; fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT
mkdir -p "$temp_dir/runtime" "$temp_dir/stage/Applications" "$output_dir"

curl --fail --location --silent --show-error --retry 3 \
  "https://nodejs.org/dist/${node_version}/${archive}" -o "$temp_dir/$archive"
actual_sha="$(shasum -a 256 "$temp_dir/$archive" | awk '{print $1}')"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "The official Node.js archive checksum did not match the pinned SHA-256." >&2
  exit 1
fi

tar -xzf "$temp_dir/$archive" -C "$temp_dir/runtime" --strip-components=2 \
  "node-${node_version}-darwin-${arch}/bin/node"
node_binary="$temp_dir/runtime/node"
if [[ "$(lipo -archs "$node_binary")" != "$expected_cpu" ]]; then
  echo "Downloaded Node.js has the wrong CPU architecture." >&2
  exit 1
fi

app_bundle="$temp_dir/stage/Applications/UBC作业管理工具.app"
bash "$repo_root/macos/build-app.sh" "$node_binary" "$app_bundle"
if [[ "$(lipo -archs "$app_bundle/Contents/MacOS/UBC作业管理工具")" != "$expected_cpu" ]]; then
  echo "Compiled macOS app has the wrong CPU architecture." >&2
  exit 1
fi

version="$("$node_binary" -p 'require(process.argv[1]).version' "$repo_root/package.json")"
base_name="ubc-assignment-manager-${version}-macos-${arch}"
package="$output_dir/${base_name}.pkg"
dmg="$output_dir/${base_name}.dmg"
zip="$output_dir/${base_name}.zip"
pkgbuild --root "$temp_dir/stage" --install-location / \
  --identifier com.anonchihaya.ubc-assignment-manager --version "$version" "$package"
pkgutil --payload-files "$package" | grep -Fq 'Applications/UBC作业管理工具.app/Contents/MacOS/UBC作业管理工具'
pkgutil --payload-files "$package" | grep -Fq 'Applications/UBC作业管理工具.app/Contents/Resources/runtime/node'
pkgutil --payload-files "$package" | grep -Fq 'Applications/UBC作业管理工具.app/Contents/Resources/runtime/email-keychain'
if pkgutil --payload-files "$package" | grep -Eq '(^|/)(\.local-data|browser-profile|data\.json|email\.json|email-secret\.dpapi|\.env)(/|$)'; then
  echo "Private data was found in the package payload." >&2
  exit 1
fi
ditto -c -k --sequesterRsrc --keepParent "$app_bundle" "$zip"
unzip -tq "$zip" >/dev/null
mkdir -p "$temp_dir/extracted"
ditto -x -k "$zip" "$temp_dir/extracted"
diff -qr "$app_bundle" "$temp_dir/extracted/UBC作业管理工具.app"
test -x "$temp_dir/extracted/UBC作业管理工具.app/Contents/MacOS/UBC作业管理工具"
test -x "$temp_dir/extracted/UBC作业管理工具.app/Contents/Resources/runtime/node"
test -x "$temp_dir/extracted/UBC作业管理工具.app/Contents/Resources/runtime/email-keychain"

mkdir -p "$temp_dir/dmg" "$temp_dir/mounted"
ditto "$app_bundle" "$temp_dir/dmg/UBC作业管理工具.app"
ln -s /Applications "$temp_dir/dmg/Applications"
hdiutil create -quiet -ov -srcfolder "$temp_dir/dmg" -volname "UBC作业管理工具" -fs APFS -format UDZO "$dmg"
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$temp_dir/mounted" "$dmg"
mounted=true
test "$(readlink "$temp_dir/mounted/Applications")" = /Applications
diff -qr "$app_bundle" "$temp_dir/mounted/UBC作业管理工具.app"
test -x "$temp_dir/mounted/UBC作业管理工具.app/Contents/MacOS/UBC作业管理工具"
test -x "$temp_dir/mounted/UBC作业管理工具.app/Contents/Resources/runtime/node"
test -x "$temp_dir/mounted/UBC作业管理工具.app/Contents/Resources/runtime/email-keychain"
hdiutil detach "$temp_dir/mounted" -quiet
mounted=false

for artifact in "$package" "$dmg" "$zip"; do
  name="$(basename "$artifact")"
  shasum -a 256 "$artifact" | awk -v name="$name" '{print $1 "  " name}' > "${artifact}.sha256"
  echo "Created $artifact and ${artifact}.sha256"
done
