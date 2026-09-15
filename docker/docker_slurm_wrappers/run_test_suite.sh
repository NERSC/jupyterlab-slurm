#!/bin/bash
# Starts a throwaway Jupyter server configured to talk to the local
# slurm-docker-cluster stand-in (via jupyter_docker_real_cluster_config.py),
# triggers the extension's opt-in compatibility harness
# (`POST .../jupyterlab_slurm/test-suite`), polls it to completion, prints
# the results, and shuts the server back down.
#
# Prerequisites:
#   - The Slurm cluster stand-in must already be up (docker/cluster.sh up).
#   - jupyterlab_slurm (this repo) must be installed in the Python
#     environment running this script (e.g. `pip install -e .` from the
#     repo root), since it's this process's own Jupyter server -- not a
#     container -- that talks to the cluster over the docker exec wrappers.
#
# Usage: docker/docker_slurm_wrappers/run_test_suite.sh
set -euo pipefail

CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_DIR}/jupyter_docker_real_cluster_config.py"
HOST="127.0.0.1"
PORT=8899
TOKEN="realclusterdockertest"
BASE_URL="http://${HOST}:${PORT}/jupyterlab_slurm/test-suite"
AUTH_HEADER="Authorization: token ${TOKEN}"
LOG_FILE="$(mktemp -t jupyterlab-slurm-test-suite.XXXXXX.log)"

echo "Starting Jupyter server against the real Slurm cluster (log: ${LOG_FILE}) ..."
jupyter server --config="${CONFIG_FILE}" --ServerApp.token="${TOKEN}" >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for the server to become ready ..."
ready=false
for _ in $(seq 1 30); do
  if curl -fsS -H "${AUTH_HEADER}" "http://${HOST}:${PORT}/api/status" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "${ready}" != "true" ]; then
  echo "Server never became ready; log follows:" >&2
  cat "${LOG_FILE}" >&2
  exit 1
fi

echo "Starting the compatibility test suite ..."
start_response="$(curl -fsS -X POST -H "${AUTH_HEADER}" -d '{}' "${BASE_URL}")"
run_id="$(echo "${start_response}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['runId'])")"
echo "Run started: ${run_id}"

status="queued"
response=""
for _ in $(seq 1 150); do
  response="$(curl -fsS -H "${AUTH_HEADER}" "${BASE_URL}/${run_id}")"
  status="$(echo "${response}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")"
  if [ "${status}" = "completed" ] || [ "${status}" = "error" ] || [ "${status}" = "cancelled" ]; then
    break
  fi
  sleep 2
done

echo "${response}" | python3 -m json.tool

if [ "${status}" != "completed" ]; then
  echo "Test suite finished with status '${status}' (expected 'completed')." >&2
  exit 1
fi

echo "${response}" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
failures = [r for r in data['results'] if not r.get('success', False)]
if failures:
    print(f'{len(failures)} scenario(s) failed:', file=sys.stderr)
    for f in failures:
        print(f\"  - {f['name']}: {f.get('message', '')}\", file=sys.stderr)
    sys.exit(1)
print('All scenarios passed.')
"
