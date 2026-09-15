#!/bin/bash
# Scenario 8 -- "I need to find and open my job's output/script files"
#
# Submits one real-script job (Edit/Open Folder should work, assuming the
# server's root_dir covers the shared /data dir) and one --wrap job (no
# script file -- Edit/Open Folder should be disabled with a clear tooltip)
# side-by-side for direct comparison.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s08_real_script.sh" '#!/bin/bash
#SBATCH --job-name=s08_real_script
#SBATCH --output='"${DIR}"'/s08_real_script_%j.out
#SBATCH --error='"${DIR}"'/s08_real_script_%j.err
#SBATCH --time=00:05:00
echo "stdout content for scenario 8"
echo "stderr content for scenario 8" >&2
sleep 60
'

echo "Submitting real-script job..."
J1=$(submit_as "${USER}" "${DIR}/s08_real_script.sh" | grep -oE '[0-9]+$')
echo "Submitting --wrap job (no script file)..."
# --chdir is required here: sbatch defaults its implicit output file
# (slurm-<jobid>.out, since no --output is given -- that's the whole
# point of this job, to have no associated script/output config) to the
# submission working directory, which for a plain `docker exec` is /data
# itself (root-owned, mode 755) -- not the per-user scenario dir. Without
# an explicit --chdir into a directory testuser1 actually owns, slurmd
# fails to open the stdout file ("Permission denied") and the job goes
# straight to FAILED instead of RUNNING.
J2=$(run_as "${USER}" sbatch --chdir="${DIR}" --wrap="sleep 60" --job-name=s08_wrap_job | grep -oE '[0-9]+$')

wait_for_state "${J1}" 'RUNNING|R' 30 || true
wait_for_state "${J2}" 'RUNNING|R' 30 || true

print_checkpoint "Job ${J1} (real script under ${DIR}) -- Command/WorkDir/Stdout/Stderr Edit+Open-Folder buttons should be enabled and work (if the server's root_dir covers ${DIR}). Job ${J2} (--wrap, no script) -- Command's Edit/Open-Folder should be disabled with a 'No associated script file' tooltip, not silently broken or misleadingly enabled."

echo "Scenario 8 done."
