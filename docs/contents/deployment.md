(deployment)=

# Deployment (JupyterHub + Slurm)

This page documents how to deploy `jupyterlab-slurm` behind JupyterHub, so
that each Hub user's single-user JupyterLab server runs Slurm commands as
their own OS identity — the deployment shape required for a shared,
multi-user Slurm cluster such as NERSC's Perlmutter.

The instructions below are extrapolated directly from a working local test
rig (`docker/jupyterhub/`) that was built and exercised end-to-end against a
real, multi-node Slurm cluster (`giovtorres/slurm-docker-cluster`, with a
fake GPU/GRES partition added) — not a theoretical config. See
`docker/jupyterhub/README.md` for the full runnable rig if you want to
reproduce or extend this validation yourself.

## Architecture

```
JupyterHub (proxy + auth)
  -> per-user login (PAM, OAuthenticator, etc.)
  -> Spawner starts a single-user JupyterLab server AS THAT USER's OS identity
       -> jupyterlab_slurm server extension loads (jupyter_server_config.py)
       -> Slurm client binaries (sbatch/squeue/scontrol/sacct/scancel) on PATH
       -> munge-authenticated calls to the real slurmctld/slurmdbd
```

The critical property this shape provides — and the one most worth testing
before a production rollout — is that **the process invoking Slurm commands
is the logged-in user's real OS user**, not a shared service account. This
is what makes Slurm's own per-user authorization (a non-owner's `scancel`
being rejected) meaningful for the extension, rather than something the
extension itself would have to reimplement.

## Requirements on the single-user server image

1. **Real Slurm client binaries** (`sbatch`, `squeue`, `scontrol`, `sacct`,
   `scancel`) installed and on `PATH` (or referenced by absolute path via
   `SlurmCommandPaths`, see {ref}`configuration`).
2. **munge** running and configured with the cluster's shared `munge.key`,
   so the client binaries can authenticate to `slurmctld`/`slurmdbd`.
3. A local **`slurm` system user/group** matching the cluster's Slurm
   `SlurmUser` uid/gid. The Slurm client tools validate `SlurmUser` (from
   `slurm.conf`) against the *local* passwd database even on a client-only
   host that never runs `slurmd`/`slurmctld` — without this, every client
   command fails with `Invalid user for SlurmUser slurm`. This was found
   during rig validation and is easy to miss.
4. A **Spawner that runs each single-user server as a real, distinct OS
   user** — e.g. `LocalProcessSpawner` (used in the test rig) with a
   system/PAM authenticator, or `SystemdSpawner`/`SudoSpawner`/
   `BatchSpawner` (e.g. NERSC's typical `wlm`-based `SlurmSpawner`/SSH
   spawner) in production. A spawner that always runs as a shared service
   account defeats the purpose of this deployment shape.
5. The `jupyterlab_slurm` Python package installed (wheel or PyPI) in the
   single-user server's environment.

## Server configuration

Put the [`SlurmCommandPaths`/`SlurmAccounting`/`SlurmUI` Traitlets](#configuration)
in a `jupyter_server_config.py` shipped to every single-user server (e.g.
via `/etc/jupyter/jupyter_server_config.py` baked into the image, or
`JUPYTER_CONFIG_DIR` set by the Spawner). See `docker/jupyterhub/jupyter_server_config.py`
for a complete, tested example, reproduced in {ref}`configuration`.

JupyterHub itself needs no `jupyterlab_slurm`-specific configuration beyond
choosing an authenticator and a spawner that satisfies requirement 4 above.
The test rig's `jupyterhub_config.py` (`docker/jupyterhub/jupyterhub_config.py`)
is a minimal reference:

```python
c.JupyterHub.authenticator_class = "pam"
c.JupyterHub.spawner_class = "jupyterhub.spawner.LocalProcessSpawner"
c.Spawner.default_url = "/lab"
```

A production deployment should replace `pam`/`LocalProcessSpawner` with
whatever authenticator/spawner combination matches the target site's
identity provider and job-launch mechanism (for NERSC, this typically means
an SSH- or Slurm-based batch spawner rather than `LocalProcessSpawner`,
which only works when the Hub and single-user servers share a local OS
user database).

## What this deployment shape validates (and what it doesn't)

Validated end-to-end with this rig:

- The single-user server process for a logged-in user runs as that user's
  real OS uid (confirmed via `ps` showing `jupyterhub-singleuser` running as
  the expected non-root uid).
- Slurm's own authorization then does the rest: the owner can
  `sbatch`/`squeue`/`scancel`/`scontrol hold` their own job; a different
  real user attempting `scancel`/`scontrol hold` on it is rejected by Slurm
  with `Access/permission denied`.
- Server-side configuration (`SlurmAccounting.sacct_time_window_days`,
  `sacct_fields`, `SlurmUI.queue_column_labels`, `squeue_reload_limit_ms`,
  etc.) takes effect and is visible via `GET /jupyterlab_slurm/ui-config`
  and in the literal `sacct`/`squeue` command lines the extension runs.
- Site hooks (`SlurmUI.site_hook_*` + `site_hook_allowlist`) load without
  error when correctly allow-listed.

Not validated by this local rig, and still required before a real NERSC
rollout:

- The actual production authenticator/spawner combination (e.g. NERSC's
  real JupyterHub batch/SSH spawner), as opposed to `LocalProcessSpawner`.
- Real GPU hardware/driver behavior (the rig's GPU/GRES partition is a
  fake/`Fake`-GRES config on CPU-only hardware).
- A real shared/parallel filesystem for job stdout/stderr paths (the rig's
  compute-node/controller filesystem topology does not match a real HPC
  shared filesystem).
- Health checks, alerting, rollback, and the remaining
  Operations/Release checklist items.

## Troubleshooting

- `squeue: fatal: Unable to process configuration file` /
  `Invalid user for SlurmUser slurm, ignored` — the single-user server
  image is missing the local `slurm` system user (see requirement 3 above).
- `unmunge` reports a key/uid mismatch, or `munged` fails to start —
  confirm the mounted `munge.key`'s owning uid matches the local `munge`
  system user's uid inside the single-user server image; rebuild the image
  if the base distro allocates a different uid for its `munge` package.
- `GET /jupyterlab_slurm/ui-config` returns defaults instead of your
  configured values — confirm the config file is actually being loaded by
  the single-user server (not just by the Hub process) by checking
  `jupyter --config-dir` / `jupyter --paths` from inside a spawned
  single-user server, and check for `Rejected hook import not in
  allowlist` warnings in the server log if a hook silently doesn't fire.
