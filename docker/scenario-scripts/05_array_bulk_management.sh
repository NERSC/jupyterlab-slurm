#!/bin/bash
# Scenario 5 -- "I submitted a batch of related jobs and need to manage
# them together"
#
# Submits a throttled array job plus several independent jobs, so you can
# test grouped display, individual task lookups, and bulk select/kill/hold.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s05_array.sh" '#!/bin/bash
#SBATCH --job-name=s05_array
#SBATCH --output='"${DIR}"'/s05_array_%A_%a.out
#SBATCH --time=00:05:00
echo "array task $SLURM_ARRAY_TASK_ID"
sleep 60
'

echo "Submitting throttled array job (--array=1-20%4)..."
OUT=$(submit_as "${USER}" --array=1-20%4 "${DIR}/s05_array.sh")
echo "${OUT}"
ARRAYID=$(echo "${OUT}" | grep -oE '[0-9]+$')

print_checkpoint "Array job ${ARRAYID} submitted (throttled to 4 concurrent tasks). Check the Queue tab -- pending tasks should be grouped like '${ARRAYID}_[5-20%4]'. Open a specific task's details (e.g. job ${ARRAYID}_1)."

echo "Submitting several independent quick jobs for bulk-selection testing..."
for i in 1 2 3 4 5; do
  submit_as "${USER}" --wrap="sleep 120" --job-name="s05_bulk_${i}" >/dev/null
done

print_checkpoint "Select multiple s05_bulk_* jobs (and/or array tasks) and try bulk Kill, bulk Hold (on pending ones), and bulk Requeue. Also try cancelling a single array task vs. the whole array (scancel ${ARRAYID} cancels all remaining tasks)."

echo "Scenario 5 done."
