# Local Slurm cluster test rigs

This directory contains everything a developer needs to run a local, real
Slurm cluster in Docker and exercise `jupyterlab-slurm` against it — no HPC
allocation required.

- `slurm-cluster/` — a plain (non-submodule) checkout of the upstream
  [`giovtorres/slurm-docker-cluster`](https://github.com/giovtorres/slurm-docker-cluster)
  project. It provides the actual Slurm cluster (`slurmctld`, `slurmdbd`,
  `slurm-cpu-worker-*`, etc.) as a Docker Compose stack. It is git-ignored in
  this repo (see `.gitignore`) rather than vendored or added as a submodule,
  so each developer checks it out independently and can pin/update it at
  will.
- `docker_slurm_wrappers/` — small `docker exec ...` wrapper scripts
  (`squeue`, `sbatch`, `scancel`, `scontrol`, `sacct`) plus
  `jupyter_docker_real_cluster_config.py`, a Jupyter Server config snippet
  that points `jupyterlab_slurm` at those wrappers. Useful for quickly
  running the extension's own Jupyter server (outside of Docker) against the
  containerized cluster below, without needing the full JupyterHub rig.
- `jupyterhub/` — a JupyterHub image that joins the same Docker network as
  the cluster and talks to it with real Slurm client binaries via shared
  munge auth, so each Hub-spawned single-user server runs as a real OS user.
  Its Slurm client RPMs are installed straight from the local
  `slurm-docker-cluster` image (see `jupyterhub/README.md`), not committed
  to this repo.
- `cluster.sh` — a single script that automates the lifecycle steps below
  (clone/up/down/destroy/status/logs/test-suite for the cluster, plus
  wheel/users/hub-up/hub-down for the JupyterHub rig) so this isn't a
  manual, multi-command process every time.

## Quick start (automated)

```bash
# Check out (if needed) and start the Slurm cluster:
docker/cluster.sh up

# ... optionally also bring up the JupyterHub rig (builds the wheel,
# provisions demo users, and starts the Hub):
docker/cluster.sh hub-up

# Or do both in one go:
docker/cluster.sh all-up

# Check status / follow logs:
docker/cluster.sh status
docker/cluster.sh logs

# Run the extension's own compatibility test suite against the cluster:
docker/cluster.sh test-suite

# Tear everything down:
docker/cluster.sh all-down
```

Run `docker/cluster.sh` with no arguments (or any unrecognized command) to
print the full list of supported commands.

## Manual steps (what `cluster.sh` does under the hood)

### 1. Check out the Slurm cluster

```bash
cd docker
git clone https://github.com/giovtorres/slurm-docker-cluster.git slurm-cluster
```

This clones into `docker/slurm-cluster`, which is intentionally git-ignored
here — it's an independent upstream project, not part of this repo. Pin to a
specific tag/commit if you need reproducibility; see that project's own
README for available Slurm versions and configuration options.

### 2. Bring up the cluster

```bash
cd docker/slurm-cluster
COMPOSE_PROJECT_NAME=slurm docker compose up -d --build
```

`COMPOSE_PROJECT_NAME=slurm` pins the resulting network/volume names to
`slurm_slurm-network`, `slurm_etc_munge`, `slurm_etc_slurm`,
`slurm_slurm_jobdir`, etc., matching what `docker/jupyterhub/docker-compose.yml`
and `docker_slurm_wrappers` expect as external resources (otherwise Compose
would derive the project name from the checkout directory, e.g.
`slurm-cluster_slurm-network`). `cluster.sh` sets this automatically. This
starts `slurmctld`, `slurmdbd`, `mysql`, and the worker nodes on that Docker
network, with named volumes exposing `/etc/munge`, `/etc/slurm`, and the
shared job directory.

### 3. Point `jupyterlab-slurm` at it

Pick one of:

- **Quick/local**: run this repo's own Jupyter server with
  `docker/docker_slurm_wrappers/jupyter_docker_real_cluster_config.py` as
  your `jupyter_server_config.py`, so `SlurmCommandPaths` resolves to the
  wrapper scripts that `docker exec` into the cluster containers.
- **Full JupyterHub rig**: follow `docker/jupyterhub/README.md` (or run
  `docker/cluster.sh hub-up`) to build and run a JupyterHub image on the
  same Docker network, authenticating real OS users against the cluster via
  shared munge — this is required to validate per-user identity and
  cross-user authorization end-to-end.

## Running the compatibility test suite against the cluster

The extension ships an opt-in, admin-configured backend compatibility
harness (`SlurmTestSuiteHandler`/`SlurmTesting`, see
`../docs/contents/api.md`) that exercises `squeue`/`sacct`/`scontrol`, and
(with mutations allowed) submits, holds, releases, cancels, and waits on
real Slurm jobs. `docker/docker_slurm_wrappers/jupyter_docker_real_cluster_config.py`
already enables it against the wrapper scripts in this directory, so once
the cluster is up you can run it end-to-end with:

```bash
docker/cluster.sh test-suite
```

This starts a throwaway Jupyter server with that config (requires
`jupyterlab_slurm` to be installed in the environment running the
script, e.g. `pip install -e .` from the repo root), POSTs to
`.../jupyterlab_slurm/test-suite`, polls the run to completion, prints the
per-scenario results, and shuts the server back down — exiting non-zero if
any scenario failed. See
`docker/docker_slurm_wrappers/run_test_suite.sh` for the underlying steps.

## Cleanup

```bash
docker/cluster.sh all-down     # or: docker/cluster.sh down / hub-down

# To also remove the cluster's Docker volumes:
docker/cluster.sh destroy
```
