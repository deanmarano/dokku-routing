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

running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == "true" ]]
}

die() {
  echo "!     $1" >&2
  docker logs "$CONTAINER" 2>&1 | tail -60 >&2
  exit 1
}

# The image's init copies skeletons into place and only then starts runit.
# Installing a plugin before that finishes poisons the init: a later init step
# iterates plugins, inherits our `commands` file's DOKKU_NOT_IMPLEMENTED_EXIT
# (10) as its own status, and the container is killed. So wait for the whole
# boot, not just for `dokku version` to answer.
echo "-----> Waiting for the image's init to finish"
for _ in $(seq 1 150); do
  running || die "Container exited during boot"
  if docker logs "$CONTAINER" 2>&1 | grep -q 'Runit started as PID'; then
    break
  fi
  sleep 2
done

docker logs "$CONTAINER" 2>&1 | grep -q 'Runit started as PID' ||
  die "Init never reached runit"

echo "-----> Waiting for Dokku to answer"
for _ in $(seq 1 60); do
  running || die "Container exited before Dokku was ready"
  docker exec "$CONTAINER" dokku version >/dev/null 2>&1 && break
  sleep 2
done

docker exec "$CONTAINER" dokku version || die "Dokku never became ready"

echo "-----> Installing the routing plugin"
PLUGIN_DIR=/var/lib/dokku/plugins/available/routing
docker exec "$CONTAINER" mkdir -p "$PLUGIN_DIR"
for item in plugin.toml config commands install functions lib providers subcommands; do
  docker cp "$REPO_ROOT/$item" "$CONTAINER:$PLUGIN_DIR/"
done
docker exec "$CONTAINER" ln -sfn "$PLUGIN_DIR" /var/lib/dokku/plugins/enabled/routing
docker exec "$CONTAINER" "$PLUGIN_DIR/install"

echo "-----> Verifying the plugin is dispatchable"
running || die "Container exited while installing the plugin"
docker exec "$CONTAINER" dokku routing:help >/dev/null
docker exec "$CONTAINER" dokku routing:list

# Whether this Dokku exposes single-field reports decides if the summary takes
# the fast path or falls back to full reports. Both are correct; knowing which
# ran makes a slow or surprising CI run explainable.
echo "-----> Single-field report support"
if docker exec "$CONTAINER" dokku ports:report --ports-map >/dev/null 2>&1; then
  echo "       ports:report --ports-map: supported"
else
  echo "       ports:report --ports-map: NOT supported, falling back to full reports"
fi

# An app the tests do not own, so the summary always has something to report
# and app-scoped assertions have a neighbour to be distinguished from.
docker exec "$CONTAINER" dokku apps:create ci-bystander >/dev/null 2>&1 || true

running || die "Container exited after the plugin was installed"
echo "-----> Ready. Run tests with DOKKU_CONTAINER=$CONTAINER"
