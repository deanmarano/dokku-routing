#!/usr/bin/env bash
# Boot a throwaway Dokku in Docker and install this plugin into it.
#
# Used by CI. Do not point this at a machine whose Docker daemon runs anything
# you care about -- it is meant for disposable runners.
set -euo pipefail

CONTAINER="${DOKKU_CONTAINER:-dokku-test}"
IMAGE="${DOKKU_IMAGE:-dokku/dokku:latest}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "-----> Starting $IMAGE as $CONTAINER"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  --privileged \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DOKKU_HOSTNAME=dokku.test \
  -e DOKKU_SKIP_KEY_FILE=true \
  "$IMAGE" >/dev/null

echo "-----> Waiting for Dokku to come up"
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" dokku version >/dev/null 2>&1; then
    docker exec "$CONTAINER" dokku version
    break
  fi
  sleep 2
done

if ! docker exec "$CONTAINER" dokku version >/dev/null 2>&1; then
  echo "!     Dokku never became ready" >&2
  docker logs "$CONTAINER" | tail -50 >&2
  exit 1
fi

echo "-----> Installing the router plugin"
PLUGIN_DIR=/var/lib/dokku/plugins/available/router
docker exec "$CONTAINER" mkdir -p "$PLUGIN_DIR"
for item in plugin.toml config commands install functions lib providers subcommands; do
  docker cp "$REPO_ROOT/$item" "$CONTAINER:$PLUGIN_DIR/"
done
docker exec "$CONTAINER" ln -sfn "$PLUGIN_DIR" /var/lib/dokku/plugins/enabled/router
docker exec "$CONTAINER" "$PLUGIN_DIR/install"

echo "-----> Verifying the plugin is dispatchable"
docker exec "$CONTAINER" dokku router:help >/dev/null
docker exec "$CONTAINER" dokku router:list

echo "-----> Ready. Run tests with DOKKU_CONTAINER=$CONTAINER"
