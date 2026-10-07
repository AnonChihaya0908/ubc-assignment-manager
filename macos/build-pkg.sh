#!/usr/bin/env bash
set -euo pipefail

# Keep the previous entry point working while the release build gains DMG and ZIP.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$script_dir/build-release.sh" "$@"
