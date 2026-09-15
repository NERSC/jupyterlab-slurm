#!/bin/bash
# Scenario 4 -- "My job failed due to a transient issue, I want to retry it"
#
# Submits a job, lets it complete, then demonstrates the MinJobAge window
# behavior for `scontrol requeue` on a COMPLETED job (outside the UI),
# plus a normal running job for in-UI Requeue/Requeue & Hold testing.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s04_quick.sh" '#!/bin/bash
#SBATCH --job-name=s04_quick
#SBATCH --output='"${DIR}"'/s04_quick_%j.out
#SBATCH --time=00:02:00
echo "quick job for requeue-window testing"
'
write_script_as "${USER}" "${DIR}/s04_running.sh" '#!/bin/bash
#SBATCH --job-name=s04_running
#SBATCH --output='"${DIR}"'/s04_running_%j.out
#SBATCH --time=00:10:00
sleep 300
'
write_script_as "${USER}" "${DIR}/s04_wrap_like.sh" 'true'

echo "Submitting quick job (for the completed-job requeue-window demo)..."
J1=$(submit_as "${USER}" "${DIR}/s04_quick.sh" | grep -oE '[0-9]+$')
echo "Submitting long-running job (for in-UI Requeue/Requeue&Hold testing)..."
J2=$(submit_as "${USER}" "${DIR}/s04_running.sh" | grep -oE '[0-9]+$')
echo "Submitting a --wrap job (for Requeue-on-wrap-job testing)..."
J3=$(run_as "${USER}" sbatch --wrap="sleep 300" --job-name=s04_wrap | grep -oE '[0-9]+$')

wait_for_state "${J1}" 'COMPLETED|CD' 30 || true

echo ""
echo "Job ${J1} is COMPLETED. Demonstrating the MinJobAge window (CLI, outside the UI):"
run_as "${USER}" scontrol requeue "${J1}" && echo "  -> requeue succeeded (still within MinJobAge window; job ${J1} should now be PENDING again)" || echo "  -> requeue failed (already purged past MinJobAge)"
docker exec "${CTLD_CONTAINER}" squeue -j "${J1}" || true

print_checkpoint "Job ${J2} (running) and ${J3} (running, --wrap) are up. In the UI: try Requeue and Requeue & Hold on each, and confirm ${J3} (no script file) behaves the same as a script-based job."

echo "Scenario 4 done."
