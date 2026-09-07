#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(git rev-parse --show-toplevel)"
data_dir="$repo_dir/data"
container_name="wawa-nocodb"
image="nocodb/nocodb:2026.06.0"
admin_email="admin@example.com"
admin_password="Wawa8082000!"

mkdir -p "$data_dir"

docker_ready=false
for _attempt in {1..60}; do
  if docker info >/dev/null 2>&1; then
    docker_ready=true
    break
  fi
  sleep 1
done

if [[ "$docker_ready" != "true" ]]; then
  echo "Docker daemon did not become ready within 60 seconds" >&2
  exit 1
fi

if docker container inspect "$container_name" >/dev/null 2>&1; then
  container_env="$(docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name")"
  if grep -Fxq "NC_ADMIN_EMAIL=$admin_email" <<<"$container_env" \
    && grep -Fxq "NC_ADMIN_PASSWORD=$admin_password" <<<"$container_env"; then
    if [[ "$(docker container inspect --format '{{.State.Running}}' "$container_name")" != "true" ]]; then
      docker container start "$container_name" >/dev/null
    fi
    exit 0
  fi
  docker container rm --force "$container_name" >/dev/null
fi

docker run --detach \
  --name "$container_name" \
  --restart unless-stopped \
  --publish 8080:8080 \
  --add-host host.docker.internal:host-gateway \
  --volume "$data_dir:/usr/app/data" \
  --env "NC_ADMIN_EMAIL=$admin_email" \
  --env "NC_ADMIN_PASSWORD=$admin_password" \
  --env NC_ATTACHMENT_FIELD_SIZE=99614720 \
  --env NC_WEBHOOK_ALLOW_PRIVATE_NETWORK=true \
  "$image"
