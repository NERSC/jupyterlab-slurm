#!/bin/bash
# Automates the manual steps documented in docker/README.md and
# docker/jupyterhub/README.md for managing the local slurm-docker-cluster
# stand-in, so day-to-day dev/test cycles don't require remembering (or
# copy/pasting) a series of `git clone`/`docker compose`/`docker exec`
# commands.
#
# Usage: docker/cluster.sh <command>
#
# Cluster lifecycle:
#   clone       Clone the upstream slurm-docker-cluster repo into
#               docker/slurm-cluster (no-op if it already exists).
#   up          Clone (if needed) and bring up the Slurm cluster stack.
#   down        Stop the Slurm cluster stack (containers kept).
#   destroy     Stop the Slurm cluster stack and remove its volumes.
#   status      Show `docker compose ps` for the cluster stack.
#   logs        Follow logs for the cluster stack.
#   wait        Wait for the Slurm controller (slurmctld) to actually be
#               answering RPCs (scontrol ping), not just for the container
#               to have started. Automatically run by `up`/`all-up` and
#               `hub-up`/`all-up` before provisioning demo users.
#   test-suite  Run the extension's opt-in compatibility harness
#               (POST .../jupyterlab_slurm/test-suite) against the running
#               cluster and report pass/fail (see docker/README.md).
#
# JupyterHub rig (docker/jupyterhub/):
#   wheel       Build the jupyterlab_slurm wheel and copy it into
#               docker/jupyterhub/jupyterlab_slurm_dist/.
#   users       Create the demo Slurm users/account on the running
#               cluster (required once, before `hub-up`).
#   hub-up      Build the wheel, create demo users, and bring up the
#               JupyterHub rig.
#   hub-down    Stop the JupyterHub rig.
#
# All-in-one:
#   all-up      up + hub-up: bring up the cluster and the JupyterHub rig.
#   all-down    hub-down + down: tear both stacks down.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLUSTER_DIR="${SCRIPT_DIR}/slurm-cluster"
CLUSTER_REPO_URL="https://github.com/giovtorres/slurm-docker-cluster.git"
HUB_DIR="${SCRIPT_DIR}/jupyterhub"

# Pin the Compose project name for the cluster stack to "slurm" (rather than
# letting it default to the checkout directory name "slurm-cluster") so the
# resulting network/volume names (slurm_slurm-network, slurm_etc_munge,
# slurm_etc_slurm, slurm_slurm_jobdir) match what
# docker/jupyterhub/docker-compose.yml expects as external resources. This is
# only applied to the cluster's own `docker compose` invocations below, not
# to the JupyterHub rig's (which uses its own, unrelated project name).
CLUSTER_COMPOSE_ENV=(env COMPOSE_PROJECT_NAME=slurm)

cluster_clone() {
  if [ -d "${CLUSTER_DIR}/.git" ]; then
    echo "docker/slurm-cluster already checked out, skipping clone."
  else
    echo "Cloning ${CLUSTER_REPO_URL} into ${CLUSTER_DIR} ..."
    git clone "${CLUSTER_REPO_URL}" "${CLUSTER_DIR}"
  fi
}

cluster_up() {
  cluster_ensure_up
  cluster_wait_for_controller
}

# Idempotently brings up the Slurm cluster stack's containers (clones the
# repo if needed, then `docker compose up -d --build`). This is safe to call
# even if the stack is already fully up (compose no-ops for services that
# are already running in the desired state), and it's also what actually
# *restarts* any container that has exited (e.g. slurmctld) since compose
# services in this stack don't set a `restart:` policy strong enough to
# recover from every stop -- `hub_users`/`hub_up` call this before waiting
# on the controller so `hub-up` alone (without `up`/`all-up` first) doesn't
# just time out waiting for a controller that stopped and was never told to
# start again.
cluster_ensure_up() {
  cluster_clone
  echo "Bringing up the Slurm cluster stack ..."
  (cd "${CLUSTER_DIR}" && "${CLUSTER_COMPOSE_ENV[@]}" docker compose up -d --build)
}

cluster_down() {
  if [ ! -d "${CLUSTER_DIR}" ]; then
    echo "docker/slurm-cluster not checked out, nothing to stop."
    return
  fi
  (cd "${CLUSTER_DIR}" && "${CLUSTER_COMPOSE_ENV[@]}" docker compose down)
}

cluster_destroy() {
  if [ ! -d "${CLUSTER_DIR}" ]; then
    echo "docker/slurm-cluster not checked out, nothing to destroy."
    return
  fi
  (cd "${CLUSTER_DIR}" && "${CLUSTER_COMPOSE_ENV[@]}" docker compose down -v)
}

cluster_status() {
  if [ ! -d "${CLUSTER_DIR}" ]; then
    echo "docker/slurm-cluster not checked out."
    return
  fi
  (cd "${CLUSTER_DIR}" && "${CLUSTER_COMPOSE_ENV[@]}" docker compose ps)
}

cluster_logs() {
  if [ ! -d "${CLUSTER_DIR}" ]; then
    echo "docker/slurm-cluster not checked out, nothing to show logs for."
    return
  fi
  (cd "${CLUSTER_DIR}" && "${CLUSTER_COMPOSE_ENV[@]}" docker compose logs -f)
}

hub_wheel() {
  # `hatch-jupyter-builder`'s `skip-if-exists` optimization (pyproject.toml)
  # skips re-running `jlpm build:prod` if
  # jupyterlab_slurm/labextension/static/style.js already exists -- which is
  # exactly the case on every rebuild once the extension has been built at
  # least once. Left alone, that silently ships a stale frontend bundle in
  # the wheel even when `src/**` has changed since the last build. Force a
  # clean rebuild every time by removing the prior build output first.
  echo "Removing stale frontend build output ..."
  rm -rf "${REPO_ROOT}/jupyterlab_slurm/labextension/static"
  echo "Building jupyterlab_slurm wheel ..."
  # `--no-isolation` reuses the currently-active Python environment's own
  # build-system packages (hatchling, hatch-jupyter-builder, jupyterlab)
  # instead of installing a fresh isolated build venv. This matters because
  # `hatch-jupyter-builder`'s npm_builder hook runs `jlpm install`/`jlpm run
  # build:prod` using whatever Yarn is bundled with the `jupyterlab` package
  # that gets installed -- a version resolved for a brand-new isolated venv
  # can end up *older* than the Yarn actually used to maintain this repo's
  # yarn.lock/.yarnrc.yml, causing "Unrecognized or legacy configuration
  # settings" failures for newer Yarn config keys. Run
  # `pip install -e '.[dev]'` (or otherwise ensure hatchling,
  # hatch-jupyter-builder and jupyterlab>=4.5.7,<5 are installed) in your
  # active environment before running this.
  (cd "${REPO_ROOT}" && python3 -m build --no-isolation --wheel)
  mkdir -p "${HUB_DIR}/jupyterlab_slurm_dist"
  cp "${REPO_ROOT}"/dist/jupyterlab_slurm-*.whl "${HUB_DIR}/jupyterlab_slurm_dist/"
}

hub_users() {
  cluster_ensure_up
  cluster_wait_for_controller
  echo "Creating demo Slurm users/account on the cluster ..."
  (cd "${HUB_DIR}" && ./setup_cluster_users.sh)
}

hub_up() {
  hub_wheel
  hub_users
  echo "Bringing up the JupyterHub rig ..."
  (cd "${HUB_DIR}" && docker compose up -d --build)
}

hub_down() {
  (cd "${HUB_DIR}" && docker compose down)
}

cluster_test_suite() {
  "${SCRIPT_DIR}/docker_slurm_wrappers/run_test_suite.sh"
}

# Waits for the Slurm controller (slurmctld) inside the cluster stack to
# actually be answering RPCs before proceeding. This matters because
# `docker compose up -d` (cluster_up) only waits for the *container* to
# start, not for slurmctld itself to finish initializing/registering with
# slurmdbd -- provisioning demo users/QOS (hub_users) or exercising the
# cluster too early can silently no-op or fail with confusing errors like
# "Unable to contact slurm controller (connect failure)" (see scenario 11).
cluster_wait_for_controller() {
  local retries="${1:-30}"
  local delay="${2:-2}"
  echo "Waiting for the Slurm controller (slurmctld) to be ready ..."
  for ((i = 1; i <= retries; i++)); do
    if docker exec slurmctld scontrol ping >/dev/null 2>&1; then
      echo "Slurm controller is up."
      return 0
    fi
    sleep "${delay}"
  done
  echo "ERROR: Slurm controller (slurmctld) did not become ready after $((retries * delay))s." >&2
  echo "Check 'docker/cluster.sh status' and 'docker/cluster.sh logs' for details." >&2
  return 1
}

case "${1:-}" in
  clone) cluster_clone ;;
  up) cluster_up ;;
  down) cluster_down ;;
  destroy) cluster_destroy ;;
  status) cluster_status ;;
  logs) cluster_logs ;;
  wait) cluster_wait_for_controller ;;
  test-suite) cluster_test_suite ;;
  wheel) hub_wheel ;;
  users) hub_users ;;
  hub-up) hub_up ;;
  hub-down) hub_down ;;
  all-up)
    cluster_up
    hub_up
    ;;
  all-down)
    hub_down
    cluster_down
    ;;
  *)
    sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
