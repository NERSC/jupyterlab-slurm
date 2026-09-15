#!/bin/bash
# Scenario 11 -- "The cluster or controller is having problems"
#
# Stops/starts slurmctld with checkpoints in between, so you can watch the
# UI's error state appear (infra-appropriate status, not misleading 404s or
# unreadable [object Object]-style crashes) and confirm it recovers cleanly
# once connectivity is restored.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

echo "Submitting a normal running job first, for the 'action in-flight when controller drops' check..."
J1=$(submit_as "${USER}" --wrap="sleep 600" --job-name=s11_before_outage --output="${DIR}/s11_before_%j.out" | grep -oE '[0-9]+$')
wait_for_state "${J1}" 'RUNNING|R' 30 || true

print_checkpoint "Job ${J1} is running and visible in the Queue. About to stop the ${CTLD_CONTAINER} container to simulate a controller outage."

echo "Stopping ${CTLD_CONTAINER}..."
docker stop "${CTLD_CONTAINER}" >/dev/null

print_checkpoint "Controller is DOWN. In the UI: refresh the queue (expect a clear infra-style error, not a crash), open Job Details for job ${J1} (expect 503-style 'controller unreachable', NOT a misleading 404 'job not found'), and try an action like Kill (expect a clean failure message)."

echo "Restarting ${CTLD_CONTAINER}..."
docker start "${CTLD_CONTAINER}" >/dev/null
echo "Waiting for slurmctld to come back up..."
sleep 8

print_checkpoint "Controller should be back. Refresh the queue and confirm the UI recovers cleanly (not stuck in an error state) and job ${J1} is visible again with its original state."

echo "Scenario 11 done. (Job ${J1} left running -- cancel via cleanup.sh when done.)"
