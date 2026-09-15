#!/bin/bash
# Scenario 6 -- "I want to check my job's resource usage while it runs"
#
# Submits a CPU-spinning job and a sleeping job side-by-side so you can
# compare TotalCPU vs Elapsed in Job Details for a meaningful contrast.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s06_cpu_spin.sh" '#!/bin/bash
#SBATCH --job-name=s06_cpu_spin
#SBATCH --output='"${DIR}"'/s06_cpu_spin_%j.out
#SBATCH --time=00:05:00
python3 -c "
import time
end = time.time() + 120
x = 0
while time.time() < end:
    x += 1
"
'
write_script_as "${USER}" "${DIR}/s06_sleeper.sh" '#!/bin/bash
#SBATCH --job-name=s06_sleeper
#SBATCH --output='"${DIR}"'/s06_sleeper_%j.out
#SBATCH --time=00:05:00
sleep 120
'

echo "Submitting CPU-spinning job..."
J1=$(submit_as "${USER}" "${DIR}/s06_cpu_spin.sh" | grep -oE '[0-9]+$')
echo "Submitting sleeping job..."
J2=$(submit_as "${USER}" "${DIR}/s06_sleeper.sh" | grep -oE '[0-9]+$')

wait_for_state "${J1}" 'RUNNING|R' 30 || true
wait_for_state "${J2}" 'RUNNING|R' 30 || true

print_checkpoint "Job ${J1} (CPU-spinning) and ${J2} (sleeping) are RUNNING. Open Job Details for each after ~30-60s and compare CPU/elapsed-time fields -- ${J1} should show real nonzero CPU usage, ${J2} should show near-zero CPU time despite similar wall-clock elapsed time (this is correct Slurm accounting, not a bug)."

echo "Scenario 6 done."
