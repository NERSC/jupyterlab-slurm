#!/bin/bash
# Scenario 3 -- "I need to pause my job to free up resources temporarily"
#
# Submits a long-running job as testuser1 for you to Suspend/Resume in the
# UI, plus a job owned by testuser2 to test the permission-denied path.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
OTHER="testuser2"
DIR=$(ensure_scenario_dir "${USER}")
DIR2=$(ensure_scenario_dir "${OTHER}")

write_script_as "${USER}" "${DIR}/s03_long_sleep.sh" '#!/bin/bash
#SBATCH --job-name=s03_long_sleep
#SBATCH --output='"${DIR}"'/s03_long_sleep_%j.out
#SBATCH --time=00:15:00
for i in $(seq 1 180); do echo "tick $i"; sleep 5; done
'
write_script_as "${OTHER}" "${DIR2}/s03_other_user.sh" '#!/bin/bash
#SBATCH --job-name=s03_other_user
#SBATCH --output='"${DIR2}"'/s03_other_user_%j.out
#SBATCH --time=00:15:00
sleep 900
'

echo "Submitting long-running job as ${USER}..."
J1=$(submit_as "${USER}" "${DIR}/s03_long_sleep.sh" | grep -oE '[0-9]+$')
echo "Submitting a job owned by ${OTHER} (for permission-denied testing)..."
J2=$(submit_as "${OTHER}" "${DIR2}/s03_other_user.sh" | grep -oE '[0-9]+$')

wait_for_state "${J1}" 'RUNNING|R' 30 || true
wait_for_state "${J2}" 'RUNNING|R' 30 || true

print_checkpoint "Job ${J1} (yours) is RUNNING. Click Pause (Suspend) on it in the UI, confirm state -> SUSPENDED and GRES/memory still held, then click Resume and confirm it continues (not restarted)."

print_checkpoint "NOTE: if you instead Requeue a SUSPENDED job (rather than Resume), real Slurm automatically applies an *admin* hold (NODELIST(REASON) = JobHeldAdmin), not a regular user hold -- confirm the Resume button correctly greys out for it (with a tooltip explaining it needs an admin), rather than letting you hit a confusing 'Access/permission denied' error from scontrol release. Also confirm that clicking Requeue on a SUSPENDED job now shows a warning tooltip and a confirmation dialog ('Requeue a suspended job?') before it fires, since the resulting admin hold can't be undone by the user themselves."

print_checkpoint "Now try Pause/Kill on job ${J2} (owned by ${OTHER}) while logged in as ${USER}. It should fail gracefully with a clear permission-denied message, not crash the UI."

print_checkpoint "Optional: select both ${J1} (running) and a pending job together and click the merged 'Pause' button -- it should Suspend the running one and Hold the pending one in the same action."

echo "Scenario 3 done. (Job ${J2} left running as ${OTHER} -- cancel via cleanup.sh when done.)"
