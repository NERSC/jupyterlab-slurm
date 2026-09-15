#!/bin/bash
# Scenario 10 -- "I'm managing jobs across a long session and
# refreshing/navigating a lot"
#
# Mostly about time passing rather than new submissions -- submits a
# handful of jobs of mixed state and walks you through a checklist that
# spans several auto-refresh cycles.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

USER="testuser1"
DIR=$(ensure_scenario_dir "${USER}")

echo "Submitting a mix of jobs for the long-session pass..."
J1=$(submit_as "${USER}" --wrap="sleep 900" --job-name=s10_long1 --output="${DIR}/s10_long1_%j.out" | grep -oE '[0-9]+$')
J2=$(submit_as "${USER}" --wrap="sleep 900" --job-name=s10_long2 --output="${DIR}/s10_long2_%j.out" | grep -oE '[0-9]+$')
J3=$(run_as "${USER}" sbatch --hold --wrap="sleep 900" --job-name=s10_held --output="${DIR}/s10_held_%j.out" | grep -oE '[0-9]+$')

# The queue needs enough jobs queued at once to meaningfully exercise
# scrolling/sorting/pinning across auto-refresh cycles -- 3 jobs isn't
# enough to see that, so pad the queue out with additional pending jobs
# (held so they don't just immediately start running and drain the queue).
EXTRA_JOBS=()
for i in $(seq 1 17); do
  EXTRA_JOBS+=("$(run_as "${USER}" sbatch --hold --wrap="sleep 900" --job-name=s10_extra${i} --output="${DIR}/s10_extra${i}_%j.out" | grep -oE '[0-9]+$')")
done

echo "Jobs: ${J1} ${J2} (running), ${J3} (held/pending), plus 17 extra held/pending jobs: ${EXTRA_JOBS[*]}"

print_checkpoint "Select jobs ${J1}, ${J2}, and ${J3} in the Queue tab (they should pin to the top). Let 2-3 auto-refresh cycles pass (watch the pie-timer countdown) WITHOUT touching them, and confirm the checkboxes stay checked and rows stay pinned."

print_checkpoint "Now switch to the Job History tab, select a few completed jobs there, click Refresh, and confirm selection survives (was previously a real bug -- selection used to reset on refresh)."

print_checkpoint "Navigate into Job Details for one of the pinned jobs and back to the Queue tab. Confirm your Queue selection/pinning wasn't disturbed by the navigation."

print_checkpoint "While jobs ${J1}/${J2}/${J3} are still selected, click a column header to sort (and Shift+click a second header for multi-sort). Confirm the sort applies and think about whether pinned rows still make sense given the new sort order."

echo "Scenario 10 done. (Jobs ${J1}/${J2}/${J3} plus 17 extra jobs (${EXTRA_JOBS[*]}) left running/held -- cancel via cleanup.sh when done.)"
