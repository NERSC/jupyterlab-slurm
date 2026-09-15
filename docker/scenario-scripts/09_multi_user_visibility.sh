#!/bin/bash
# Scenario 9 -- "I only care about my own jobs on a busy shared cluster"
#
# Submits jobs as both testuser1 and testuser2, so you can log in as each
# via JupyterHub and check "My jobs only" filtering and cross-user action
# denial.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

DIR1=$(ensure_scenario_dir "testuser1")
DIR2=$(ensure_scenario_dir "testuser2")

echo "Submitting jobs as testuser1..."
for i in 1 2 3; do
  submit_as testuser1 --wrap="sleep 600" --job-name="s09_t1_${i}" --output="${DIR1}/s09_t1_${i}_%j.out" >/dev/null
done

echo "Submitting jobs as testuser2..."
for i in 1 2 3; do
  submit_as testuser2 --wrap="sleep 600" --job-name="s09_t2_${i}" --output="${DIR2}/s09_t2_${i}_%j.out" >/dev/null
done

echo "Current queue (both users):"
docker exec "${CTLD_CONTAINER}" squeue -o '%.10i %.9u %.20j %.2t'

print_checkpoint "Log into JupyterHub as testuser1/testuser1 (http://127.0.0.1:8000). Confirm the full queue shows both s09_t1_* and s09_t2_* jobs, but 'My jobs only' shows only the s09_t1_* ones. Try Hold/Suspend/Kill on an s09_t2_* job -- expect a clean permission-denied message, not a crash."

print_checkpoint "Log out and log back in as testuser2/testuser2. Repeat the same checks the other direction (My jobs only -> s09_t2_* only; actions on s09_t1_* jobs -> permission denied)."

echo "Scenario 9 done."
