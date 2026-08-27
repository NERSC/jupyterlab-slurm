# Local JupyterHub + real Slurm cluster test rig

This directory builds a JupyterHub image that joins the same Docker network
as the `slurm-docker-cluster` stand-in and talks to it with **real** Slurm
client binaries (`sbatch`/`squeue`/`scontrol`/`sacct`/`scancel`) authenticated
via the cluster's shared munge key — not via `docker exec ... --user root`
wrapper scripts. Each Hub-spawned single-user JupyterLab server runs as a
real, distinct OS user (via `LocalProcessSpawner` + PAM login), so this rig
can validate the parts of production hardening that a single root server
can't:

- The extension's server process actually runs Slurm commands as the
  logged-in user's own OS identity (release-blocker "validate command
  execution and identity on a real target cluster").
- Cross-user authorization *through the extension's own HTTP endpoints*
  (not just Slurm's own permission model, which was already verified
  separately with `docker exec`).
- A real browser/cookie-based JupyterHub login + XSRF flow, rather than a
  manually constructed cookie jar.
- Deployment-time server configuration (`SlurmCommandPaths`,
  `SlurmAccounting`, `SlurmUI`, site hooks) — `jupyter_server_config.py` in
  this directory is a working, rig-validated example (see
  `../../docs/contents/configuration.md` and
  `../../docs/contents/deployment.md` for the extrapolated documentation).

## Prerequisites

The `slurm-docker-cluster` stand-in (`slurmctld`, `slurmdbd`,
`slurm-cpu-worker-*`, optionally `slurm-gpu-worker-*`) must already be
running, on network `slurm_slurm-network`, with named volumes
`slurm_etc_munge`, `slurm_etc_slurm`, `slurm_slurm_jobdir` (e.g. via
`docker/cluster.sh up`). This image's `Dockerfile` also needs the local
`slurm-docker-cluster:<version>` image to already be *built* (which
`cluster.sh up` does): rather than committing a copy of the Slurm client
binaries to this repo, the Hub image installs the exact same Slurm RPMs the
cluster containers run, straight from that image's own RPM cache
(`/var/cache/slurm-rpms/`) via a multi-stage `COPY --from=`. No manual
extraction step is needed, and the `SLURM_VERSION` build arg (see
`docker-compose.yml`) keeps it in sync with whatever version the cluster is
running.

## Usage

### Automated (recommended)

From the repo root, `docker/cluster.sh hub-up` builds the wheel, provisions
the demo users, and starts the Hub in one step (assumes the cluster stack is
already up, e.g. via `docker/cluster.sh up`, or use `docker/cluster.sh
all-up` to bring up both):

```bash
docker/cluster.sh hub-up
```

Then log in at http://localhost:8000 as testuser1 / testuser2 (any password
accepted by PAM in this throwaway image -- set via `chpasswd` in
entrypoint.sh) or hubadmin (admin).

### Manual (what `cluster.sh hub-up` does under the hood)

```bash
# 1. Rebuild the jupyterlab_slurm wheel from the repo root and copy it in
#    (skip if jupyterlab_slurm_dist/*.whl is already up to date):
cd <path-to-repo-root>  # the jupyterlab-slurm checkout, e.g. `cd ../..` from here
python3 -m build --wheel
cp dist/jupyterlab_slurm-*.whl docker/jupyterhub/jupyterlab_slurm_dist/

# 2. Create matching demo users/account on the Slurm cluster side.
cd docker/jupyterhub
./setup_cluster_users.sh

# 3. Build and start the Hub.
docker compose up -d --build

# 4. Log in at http://localhost:8000 as testuser1 / testuser2 (any password
#    accepted by PAM in this throwaway image -- set via `chpasswd` in
#    entrypoint.sh) or hubadmin (admin).
```

Each logged-in user gets their own real single-user JupyterLab server
(running as their own OS user), with the jupyterlab-slurm extension
pre-installed and pointed at the real cluster. Submit/cancel jobs as
`testuser1` and confirm `testuser2` cannot see or act on them through the
extension's own UI/API -- that's the identity-mapping + cross-user
authorization test this rig exists to enable.

## Cleanup

```bash
docker/cluster.sh hub-down     # or, from this directory: docker compose down

# optional: remove the demo users/account from the Slurm side
docker exec slurmctld sacctmgr -i delete account jhubtest
for c in slurmctld slurm-cpu-worker-1 slurm-cpu-worker-2 slurm-gpu-worker-1; do
  docker exec "$c" bash -c "userdel -r testuser1 2>&1; userdel -r testuser2 2>&1" || true
done
```
