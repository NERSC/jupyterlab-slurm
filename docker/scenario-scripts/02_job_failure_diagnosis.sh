#!/bin/bash
# Scenario 2 -- "My job died, why?" (failure diagnosis)
#
# Submits three jobs that fail in three distinct ways: plain nonzero exit,
# OOM-kill, and wall-time TIMEOUT. Check Job History for each afterward.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

write_script_as "${USER}" "${DIR}/s02_exit_nonzero.sh" '#!/bin/bash
#SBATCH --job-name=s02_exit_nonzero
#SBATCH --output='"${DIR}"'/s02_exit_nonzero_%j.out
#SBATCH --error='"${DIR}"'/s02_exit_nonzero_%j.err
#SBATCH --time=00:02:00
echo "about to fail with a real error message" >&2
exit 3
'

write_script_as "${USER}" "${DIR}/s02_oom.sh" '#!/bin/bash
#SBATCH --job-name=s02_oom
#SBATCH --output='"${DIR}"'/s02_oom_%j.out
#SBATCH --error='"${DIR}"'/s02_oom_%j.err
#SBATCH --mem=20M
#SBATCH --time=00:02:00
echo "requested --mem=20M, about to allocate 200M -- this cluster now enforces"
echo "real cgroup memory limits (ConstrainRAMSpace=yes, ConstrainSwapSpace=yes),"
echo "so this job is expected to be OOM-killed before printing anything further"
python3 -c "
x = bytearray(200 * 1024 * 1024)
print(len(x), \"bytes allocated successfully\")
"
alloc_rc=$?
# Note: bash keeps running after the python3 process is OOM-killed (it just
# reports "Killed" and the real exit code, e.g. 137, in $?) -- it does NOT
# skip the rest of the script the way "if this line is visible" implied.
# So we must explicitly check the exit code here rather than unconditionally
# printing a warning after every run.
if [ "$alloc_rc" -eq 0 ]; then
  echo "allocation call returned with exit code 0 -- memory limits were not" >&2
  echo "enforced for this job (unexpected -- check cgroup.conf)" >&2
else
  echo "allocation call was killed (exit code ${alloc_rc}), as expected when" >&2
  echo "cgroup memory limits are enforced" >&2
fi
'

write_script_as "${USER}" "${DIR}/s02_timeout.sh" '#!/bin/bash
#SBATCH --job-name=s02_timeout
#SBATCH --output='"${DIR}"'/s02_timeout_%j.out
#SBATCH --time=00:00:20
echo "sleeping past the time limit on purpose"
sleep 120
'

echo "Submitting exit-nonzero job..."
J1=$(submit_as "${USER}" "${DIR}/s02_exit_nonzero.sh" | grep -oE '[0-9]+$')
echo "Submitting OOM job..."
J2=$(submit_as "${USER}" "${DIR}/s02_oom.sh" | grep -oE '[0-9]+$')
echo "Submitting TIMEOUT job..."
J3=$(submit_as "${USER}" "${DIR}/s02_timeout.sh" | grep -oE '[0-9]+$')

echo "Jobs: exit-nonzero=${J1} oom=${J2} timeout=${J3}"
echo "Note: exit-nonzero and oom finish almost instantly (well under a second) and"
echo "will already be gone from the live Queue tab by the time you can look -- only"
echo "the ~60s timeout job stays visible there. Use the Job History tab (sacct-backed,"
echo "keeps all three) to inspect all three jobs, not the live Queue."
echo "Waiting ~60s for all three to finish (FAILED/OUT_OF_MEMORY/TIMEOUT)..."
sleep 60

echo "Real states (sacct):"
docker exec "${CTLD_CONTAINER}" sacct -j "${J1},${J2},${J3}" -o JobID,JobName,State,ExitCode --noheader

print_checkpoint "Check Job History (not Queue) for jobs ${J1} (FAILED, exit code 3, real stderr content), ${J2} (OUT_OF_MEMORY, with an oom_kill event visible in stderr), and ${J3} (TIMEOUT). Also check an empty-stderr case is rendered as 'no output', not an error.

NOTE: this cluster's cgroup.conf has both ConstrainRAMSpace=yes and
ConstrainSwapSpace=yes, so real cgroup memory limits are genuinely enforced
and excess anonymous memory can no longer be transparently swapped out --
job ${J2} should now reliably show OUT_OF_MEMORY (verified live: memory.max
is written per-job, memory.current is capped, and a real oom_kill event is
logged in stderr for a job that exceeds its --mem request)."

echo "Scenario 2 done."
