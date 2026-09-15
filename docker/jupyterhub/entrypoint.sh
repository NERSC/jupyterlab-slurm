#!/bin/bash
# Boots munge (needed by the real Slurm client tools to authenticate to the
# shared slurmctld/slurmdbd), makes sure a couple of demo OS users exist so
# JupyterHub can spawn real per-user single-user servers, then starts the Hub.
set -euo pipefail

# The cluster's shared munge.key is mounted read-only at /etc/munge/munge.key
# (named volume `slurm_etc_munge` from the slurm-docker-cluster stand-in, same
# key the slurmctld/worker containers use). It's already owned by uid/gid 998
# ("munge") in that volume, and this image's `munge` package happens to also
# allocate uid/gid 998 for its own `munge` user (verified against a fresh
# rockylinux:9 install), so no chown/chmod of the shared, read-only key is
# needed or possible here -- only our own local runtime dirs need creating.
mkdir -p /var/lib/munge /var/log/munge /var/run/munge
chown -R munge:munge /var/lib/munge /var/log/munge /var/run/munge
if [ "$(stat -c %u /etc/munge/munge.key)" != "$(id -u munge)" ]; then
  echo "WARNING: /etc/munge/munge.key owner uid does not match local munge uid;" >&2
  echo "         munged will likely fail to start. Rebuild the image or fix uids." >&2
fi
runuser -u munge -- /usr/sbin/munged --force
sleep 1
runuser -u munge -- unmunge < /dev/null > /dev/null 2>&1 || true

# The Slurm client tools validate `SlurmUser` (from slurm.conf) against the
# *local* passwd database even though this container never runs slurmd/
# slurmctld -- so a local `slurm` user (matching the cluster's uid/gid 990)
# must exist here too, or every client command fails with
# "Invalid user for SlurmUser slurm".
if ! id slurm >/dev/null 2>&1; then
  groupadd -g 990 slurm
  useradd -M -u 990 -g 990 -s /sbin/nologin slurm
fi

# Demo Hub users. UIDs match the OS users created on the slurmctld/worker
# containers via `sacctmgr add user` earlier, so job ownership/authorization
# lines up across containers.
for spec in "hubadmin:2000" "testuser1:2001" "testuser2:2002"; do
  name="${spec%%:*}"
  uid="${spec##*:}"
  if ! id "$name" >/dev/null 2>&1; then
    useradd -m -u "$uid" -s /bin/bash "$name"
    echo "${name}:${name}" | chpasswd
  fi
done

exec jupyterhub -f /srv/jupyterhub/jupyterhub_config.py
