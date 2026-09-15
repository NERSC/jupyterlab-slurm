#!/bin/bash
# Cleans up jobs submitted by the scenario scripts, so repeated runs don't
# accumulate stale queue entries. Does NOT touch cluster config (e.g. fake
# GPU GRES setup) -- that's left in place for reuse across sessions.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

for u in testuser1 testuser2; do
  echo "Cancelling all queued/running jobs for ${u}..."
  docker exec "${CTLD_CONTAINER}" scancel -u "${u}" 2>&1 || true
done

echo "Done. Scenario job scripts/output under /data/<user>_scenarios were left in place for inspection -- remove manually if you want a fully clean slate."
