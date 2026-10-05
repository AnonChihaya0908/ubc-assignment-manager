#!/usr/bin/env bash
set -euo pipefail

package="${1:?Pass the package to smoke test}"
if [[ "$(uname -s)" != "Darwin" || ! -f "$package" ]]; then
  echo "Provide a built macOS package on a macOS runner." >&2
  exit 1
fi

sudo installer -pkg "$package" -target /
app="/Applications/UBC作业管理工具.app"
binary="$app/Contents/MacOS/UBC作业管理工具"
test -x "$binary"
test -x "$app/Contents/Resources/runtime/node"

"$binary" > /tmp/ubc-assignment-manager-smoke.log 2>&1 &
app_pid=$!
cleanup() {
  if kill -0 "$app_pid" 2>/dev/null; then
    osascript -e 'tell application id "com.anonchihaya.ubc-assignment-manager" to quit' >/dev/null 2>&1 || true
    kill "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:43873/; then
    ready=true
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "The installed app exited before its main window could start." >&2
    exit 1
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "The installed app did not start its local service within 60 seconds." >&2
  exit 1
fi

api_status="$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:43873/api/state)"
if [[ "$api_status" != 403 ]]; then
  echo "The installed app did not protect its native API (HTTP $api_status)." >&2
  exit 1
fi

"$binary" > /tmp/ubc-assignment-manager-second-launch.log 2>&1 &
second_pid=$!
for ((attempt = 0; attempt < 10; attempt++)); do
  if ! kill -0 "$second_pid" 2>/dev/null; then break; fi
  sleep 1
done
if kill -0 "$second_pid" 2>/dev/null; then
  kill "$second_pid" 2>/dev/null || true
  echo "A second app instance stayed open instead of activating the first." >&2
  exit 1
fi
wait "$second_pid"
kill -0 "$app_pid"
echo "Installed desktop app launched, protected its API, and reused the first instance."
