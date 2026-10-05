#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packages must be built on macOS." >&2
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
trap 'rm -rf "$temp_dir"' EXIT
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
pkgbuild --root "$temp_dir/stage" --install-location / \
  --identifier com.anonchihaya.ubc-assignment-manager --version "$version" "$package"
pkgutil --payload-files "$package" | grep -Fq 'Applications/UBC作业管理工具.app/Contents/MacOS/UBC作业管理工具'
pkgutil --payload-files "$package" | grep -Fq 'Applications/UBC作业管理工具.app/Contents/Resources/runtime/node'
if pkgutil --payload-files "$package" | grep -Eq '(^|/)(\.local-data|browser-profile|data\.json|\.env)(/|$)'; then
  echo "Private data was found in the package payload." >&2
  exit 1
fi
shasum -a 256 "$package" | awk -v name="${base_name}.pkg" '{print $1 "  " name}' > "${package}.sha256"
echo "Created $package and ${package}.sha256"
