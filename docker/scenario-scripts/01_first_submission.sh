#!/bin/bash
# Scenario 1 -- "Did my job start yet?" (new user, first submission)
#
# Submits one normal job and one deliberately-malformed submission, with
# checkpoints so you can inspect the queue/Job Details in the browser at
# each stage.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s01_hello.sh" '#!/bin/bash
#SBATCH --job-name=s01_hello
#SBATCH --output='"${DIR}"'/s01_hello_%j.out
#SBATCH --time=00:05:00
echo "hello from scenario 1"
sleep 30
'

echo "Submitting a normal job as ${USER}..."
OUT=$(submit_as "${USER}" "${DIR}/s01_hello.sh")
echo "${OUT}"
JOBID=$(echo "${OUT}" | grep -oE '[0-9]+$')

print_checkpoint "Job ${JOBID} submitted. Open the Queue tab now -- it should appear as PD, then transition to R. Open Job Details before it starts (few fields populated) and after (Nodes/StartTime populated)."

wait_for_state "${JOBID}" 'RUNNING|R' 30 || true

print_checkpoint "Job ${JOBID} should now be RUNNING. Re-check Job Details for populated fields."

echo "Now submitting a deliberately-malformed job (bad partition)..."
run_as "${USER}" sbatch --partition=does-not-exist --wrap="echo bad" || echo "(sbatch rejected the submission as expected -- confirm the extension surfaces a clear /sbatch failure message, not a crash, if you try this via the UI's submit form instead of the CLI)"

echo "Scenario 1 done."
