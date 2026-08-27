#!/bin/bash
# Creates the Linux users and Slurm account on the slurm-docker-cluster
# stand-in (slurmctld + cpu/gpu worker containers) that match the demo
# JupyterHub accounts provisioned by entrypoint.sh (same UIDs), so job
# ownership lines up when jobs submitted from the Hub-spawned single-user
# servers are inspected/cancelled from either side.
#
# Run this once against the running slurm-docker-cluster stand-in *before*
# starting the jupyterhub container (`docker compose up -d`).
set -euo pipefail

USERS=("testuser1:2001" "testuser2:2002")

for spec in "${USERS[@]}"; do
  name="${spec%%:*}"
  uid="${spec##*:}"
  for c in slurmctld slurm-cpu-worker-1 slurm-cpu-worker-2 slurm-gpu-worker-1; do
    docker exec "$c" bash -c "id ${name} >/dev/null 2>&1 || useradd -m -u ${uid} ${name}" || true
  done
done

docker exec slurmctld sacctmgr -i add account jhubtest 2>&1 || true
for spec in "${USERS[@]}"; do
  name="${spec%%:*}"
  docker exec slurmctld sacctmgr -i add user "${name}" Account=jhubtest 2>&1 || true
done

echo "Done. testuser1/testuser2 now exist (uid 2001/2002) on all cluster containers"
echo "and are associated with Slurm account 'jhubtest'."
