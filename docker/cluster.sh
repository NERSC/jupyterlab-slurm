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
  echo "Building jupyterlab_slurm wheel ..."
  (cd "${REPO_ROOT}" && python3 -m build --wheel)
  mkdir -p "${HUB_DIR}/jupyterlab_slurm_dist"
  cp "${REPO_ROOT}"/dist/jupyterlab_slurm-*.whl "${HUB_DIR}/jupyterlab_slurm_dist/"
}

hub_users() {
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

case "${1:-}" in
  clone) cluster_clone ;;
  up) cluster_up ;;
  down) cluster_down ;;
  destroy) cluster_destroy ;;
  status) cluster_status ;;
  logs) cluster_logs ;;
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
