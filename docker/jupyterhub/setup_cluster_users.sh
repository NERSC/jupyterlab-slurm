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

created_new_user=0
for spec in "${USERS[@]}"; do
  name="${spec%%:*}"
  uid="${spec##*:}"
  for c in slurmctld slurm-cpu-worker-1 slurm-cpu-worker-2 slurm-gpu-worker-1; do
    if docker exec "$c" bash -c "id ${name} >/dev/null 2>&1"; then
      continue
    fi
    docker exec "$c" bash -c "useradd -m -u ${uid} ${name}" || true
    if [ "$c" = "slurmctld" ]; then
      created_new_user=1
    fi
  done
done

# slurmctld resolves job-submitting UIDs against the passwd/NSS state it
# had at process startup -- a Linux user created via `useradd` *after*
# slurmctld is already running is invisible to it until it's restarted
# (symptom: `sbatch` fails with "Invalid account or account/partition
# combination specified" and slurmctld.log shows "User <uid> not found",
# even though `sacctmgr`/`getent passwd` both already see the new user
# fine). Restart it here whenever a new OS user was just added to its
# container, so a fresh `hub-up`/`all-up` run doesn't require a manual
# restart to submit jobs.
if [ "${created_new_user}" -eq 1 ]; then
  echo "New OS user(s) created on slurmctld; restarting it so it picks up the updated passwd state ..."
  docker restart slurmctld >/dev/null
  for i in $(seq 1 30); do
    if docker exec slurmctld scontrol ping >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

docker exec slurmctld sacctmgr -i add account jhubtest 2>&1 || true
for spec in "${USERS[@]}"; do
  name="${spec%%:*}"
  docker exec slurmctld sacctmgr -i add user "${name}" Account=jhubtest 2>&1 || true
done

# A handful of QOS types for testing `--qos=<name>` submission, Job Details'
# QOS field, and any QOS-based scheduling/priority behavior in the
# extension. Named/modeled after NERSC Perlmutter's real QOS tiers, so the
# extension sees the same QOS vocabulary and preemption relationship it
# will encounter in production:
#   - debug:    short, high-priority, tightly capped (interactive testing)
#   - regular:  the everyday default tier
#   - premium:  elevated priority above regular, same wall-time limits
#   - preempt:  lower priority than regular; may be preempted/requeued
#   - overrun:  lowest priority, best-effort backfill tier
QOS_SPECS=(
  "debug:Priority=100 MaxWall=00:30:00 MaxJobsPerUser=2"
  "regular:Priority=10"
  "premium:Priority=1000"
  "preempt:Priority=5 Preempt=regular,premium"
  "overrun:Priority=1"
)
for spec in "${QOS_SPECS[@]}"; do
  name="${spec%%:*}"
  opts="${spec#*:}"
  # shellcheck disable=SC2086  # intentional word-splitting: sacctmgr needs
  # each Key=Value pair as its own argument, not one comma-joined string.
  docker exec slurmctld sacctmgr -i add qos "${name}" ${opts} 2>&1 || true
done
# QOS names must also be registered on the cluster itself (a fresh cluster
# only has "normal" in its QOS list by default) before they can actually be
# used by an association -- otherwise submissions can fail even though
# `sacctmgr show assoc` already lists them against the account/user.
docker exec slurmctld sacctmgr -i modify cluster linux set \
  qos+=debug,regular,premium,preempt,overrun 2>&1 || true
docker exec slurmctld sacctmgr -i modify account jhubtest set \
  qos=debug,regular,premium,preempt,overrun 2>&1 || true
# With AccountingStorageEnforce=...,qos (Perlmutter-style, set in slurm.conf)
# Slurm rejects any job submitted without an explicit --qos unless a
# default QOS can be resolved for it -- there's no cluster-wide or
# partition default configured here, so without this the association's
# DefaultQOS being unset makes every plain `sbatch` (no --qos) fail with
# "Invalid qos specification".
docker exec slurmctld sacctmgr -i modify account jhubtest set \
  DefaultQOS=regular 2>&1 || true

echo "Done. testuser1/testuser2 now exist (uid 2001/2002) on all cluster containers"
echo "and are associated with Slurm account 'jhubtest'."
echo "QOS types debug/regular/premium/preempt/overrun are available -- submit with e.g."
echo "  sbatch --qos=premium --wrap='sleep 60'"
