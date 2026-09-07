#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(git rev-parse --show-toplevel)"
cd "$repo_dir"

git config core.hooksPath .githooks
if ! git config user.name >/dev/null; then
  git config user.name "NocoDB Publisher"
fi
if ! git config user.email >/dev/null; then
  git config user.email "nocodb-publisher@users.noreply.github.com"
fi

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# The NocoDB sibling container reaches the publisher through Docker's host gateway.
export PUBLISH_HOST=0.0.0.0

nocodb_launcher_pid_file="/tmp/wawa-nocodb-launcher.pid"
if [[ ! -f "$nocodb_launcher_pid_file" ]] || ! kill -0 "$(<"$nocodb_launcher_pid_file")" 2>/dev/null; then
  nohup bash .devcontainer/start-nocodb.sh >/tmp/wawa-nocodb.log 2>&1 &
  echo "$!" >"$nocodb_launcher_pid_file"
fi

publisher_pid_file="/tmp/wawa-nocodb-publisher.pid"
if [[ -f "$publisher_pid_file" ]] && kill -0 "$(cat "$publisher_pid_file")" 2>/dev/null; then
  exit 0
fi

nohup node scripts/publisher-server.mjs >/tmp/wawa-nocodb-publisher.log 2>&1 &
echo "$!" >"$publisher_pid_file"
